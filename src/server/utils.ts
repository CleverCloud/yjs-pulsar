import * as http from 'http';
import ws from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as mutex from 'lib0/mutex';
import Pulsar from 'pulsar-client';

import { ServerConfig, PulsarClientContainer } from '../types';
import { cleanupManager } from './cleanup';
import { Storage, S3Storage } from '../storage';

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

const messageSync = 0;
const messageAwareness = 1;
const PULSAR_ORIGIN = 'pulsar';

const pingTimeout = 30000;

const docs: Map<string, YDoc> = new Map();
const pulsarReconnectMutex = mutex.createMutex();

let storage: Storage | null;
let storageInitialized = false;

export const resetStorage = () => {
    storage = null;
    storageInitialized = false;
};

export const getStorage = (): Storage | null => {
    if (!storageInitialized) {
        const storageType = process.env.STORAGE_TYPE;
        if (storageType === 's3') {
            storage = new S3Storage();
        } else {
            storage = null;
        }
        storageInitialized = true;
    }
    return storage;
};

export const createPulsarClient = (config: ServerConfig): Pulsar.Client => {
    console.log('Creating Pulsar client with config:', {
        serviceUrl: config.pulsarUrl,
        operationTimeoutSeconds: 120,
        tokenProvided: !!config.pulsarToken,
    });
    const clientConfig: Pulsar.ClientConfig = {
        serviceUrl: config.pulsarUrl,
        operationTimeoutSeconds: 120,
    };
    if (config.pulsarToken) {
        clientConfig.authentication = new Pulsar.AuthenticationToken({ token: config.pulsarToken });
    }
    return new Pulsar.Client(clientConfig);
};

const getFullTopicName = (config: ServerConfig, docName: string) => {
    return `persistent://${config.pulsarTenant}/${config.pulsarNamespace}/${config.pulsarTopicPrefix}${docName}`;
};

const checkPulsarConnection = async (client: Pulsar.Client, config: ServerConfig): Promise<boolean> => {
    let producer: Pulsar.Producer | null = null;
    const healthCheckTopic = `persistent://${config.pulsarTenant}/${config.pulsarNamespace}/health-check-topic`;
    try {
        producer = await client.createProducer({
            topic: healthCheckTopic,
            sendTimeoutMs: 5000,
            maxPendingMessages: 1,
        });
        return true;
    } catch (error) {
        console.error('Pulsar connection health check failed:', error);
        return false;
    } finally {
        if (producer) {
            try {
                await producer.close();
            } catch (closeError) {
                console.error('Error closing health check producer:', closeError);
            }
        }
    }
};

export class YDoc extends Y.Doc {
    name: string;
    mux: mutex.mutex;
    awareness: awarenessProtocol.Awareness;
    conns: Map<ws.WebSocket, Set<number>>;
    producer: Pulsar.Producer | null = null;
    consumer: Pulsar.Consumer | null = null;

    constructor(name: string) {
        super({ gc: true });
        this.name = name;
        this.mux = mutex.createMutex();
        this.awareness = new awarenessProtocol.Awareness(this);
        this.conns = new Map();

        this.on('update', this.updateHandler.bind(this));
        this.awareness.on('update', this.awarenessHandler.bind(this));
    }

    updateHandler(update: Uint8Array, origin: any) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.writeUpdate(encoder, update);
        const message = encoding.toUint8Array(encoder);

        this.conns.forEach((_, conn) => {
            if (conn !== origin) { // Do not send back to the originator
                send(this, conn, message);
            }
        });

        if (origin !== PULSAR_ORIGIN) {
            const producer = this.producer;
            if (producer) {
                const pulsarMessage = Buffer.concat([Buffer.from([messageSync]), Buffer.from(update)]);
                producer.send({ data: pulsarMessage });
            }
        }
    }

    awarenessHandler({ added, updated, removed }: { added: number[], updated: number[], removed: number[] }, origin: any) {
        const changedClients = added.concat(updated, removed);
        const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients);
        const wsMessage = (() => {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, messageAwareness);
            encoding.writeVarUint8Array(encoder, awarenessUpdate);
            return encoding.toUint8Array(encoder);
        })();

        this.conns.forEach((_, conn) => send(this, conn, wsMessage));

        if (origin !== PULSAR_ORIGIN) {
            const producer = this.producer;
            if (producer) {
                const pulsarMessage = Buffer.concat([Buffer.from([messageAwareness]), Buffer.from(awarenessUpdate)]);
                producer.send({ data: pulsarMessage });
            }
        }
    }

    async destroy() {
        console.log(`[${this.name}] Destroying YDoc`);
        const storage = getStorage();
        if (storage) {
            try {
                await storage.storeDoc(this.name, Y.encodeStateAsUpdate(this));
            } catch (err) {
                console.error(`[${this.name}] Failed to store document state`, err);
            }
        }

        const closeProducer = this.producer ? this.producer.close() : Promise.resolve();
        const closeConsumer = this.consumer ? this.consumer.close() : Promise.resolve();

        await Promise.all([closeProducer, closeConsumer]).catch(err => {
            console.error(`[${this.name}] Error closing Pulsar resources`, err);
        });

        super.destroy();
        docs.delete(this.name);
        console.log(`[${this.name}] YDoc destroyed and removed from docs map`);
    }
}

const reconnectPulsarClient = async (pulsarClientContainer: PulsarClientContainer, pulsarConfig: ServerConfig) => {
    pulsarReconnectMutex(async () => {
        if (pulsarClientContainer.client && await checkPulsarConnection(pulsarClientContainer.client, pulsarConfig)) {
            return;
        }

        console.log('Pulsar client disconnected. Reconnecting...');
        if (pulsarClientContainer.client) {
            try {
                await pulsarClientContainer.client.close();
            } catch (e) {
                console.error('Failed to close stale Pulsar client', e);
            }
        }
        pulsarClientContainer.client = createPulsarClient(pulsarConfig);
        docs.forEach(doc => doc.destroy());
        docs.clear();
    });
};

export const onClose = (conn: ws.WebSocket, doc: YDoc) => {
    const controlledIds = doc.conns.get(conn);
    if (controlledIds) {
        doc.conns.delete(conn);
        awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
        if (doc.conns.size === 0) {
            const cleanupPromise = doc.destroy();
            cleanupManager.add(cleanupPromise);
        }
    }
};

const send = (doc: YDoc, conn: ws.WebSocket, message: Uint8Array) => {
    if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
        onClose(conn, doc);
        return;
    }
    try {
        conn.send(message, (err: any) => {
            err && onClose(conn, doc);
        });
    } catch (e) {
        onClose(conn, doc);
    }
};

const MAX_RETRIES = 3;

export const getYDoc = async (docName: string, pulsarClientContainer: PulsarClientContainer, pulsarConfig: ServerConfig): Promise<YDoc> => {
    const existingDoc = docs.get(docName);
    if (existingDoc) {
        return existingDoc;
    }

    const newDoc = new YDoc(docName);
    docs.set(docName, newDoc);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const storage = getStorage();
            if (storage) {
                const data = await storage.getDoc(docName);
                if (data) {
                    Y.applyUpdate(newDoc, data);
                }
            }

            if (!pulsarClientContainer.client || !(await checkPulsarConnection(pulsarClientContainer.client, pulsarConfig))) {
                if (pulsarClientContainer.client) {
                    try {
                        await pulsarClientContainer.client.close();
                    } catch (e) {
                        console.warn('Error closing stale Pulsar client, creating new one.', e);
                    }
                }
                pulsarClientContainer.client = createPulsarClient(pulsarConfig);
            }

            if (!await checkPulsarConnection(pulsarClientContainer.client, pulsarConfig)) {
                throw new Error('Pulsar connection is not alive.');
            }

            const topicName = getFullTopicName(pulsarConfig, docName);

            if (!newDoc.producer) {
                newDoc.producer = await pulsarClientContainer.client.createProducer({
                    topic: topicName,
                    producerName: `${docName}-producer-${Date.now()}`,
                    sendTimeoutMs: 30000,
                });
            }

            if (!newDoc.consumer) {
                newDoc.consumer = await pulsarClientContainer.client.subscribe({
                    topic: topicName,
                    subscription: `${docName}-subscription`,
                    subscriptionType: 'Shared',
                    ackTimeoutMs: 10000,
                });
            }

            (async () => {
                const consumer = newDoc.consumer;
                if (!consumer) return;

                while (await consumer.isConnected()) {
                    try {
                        const receivedMsg = await consumer.receive();
                        const data = receivedMsg.getData();
                        const messageType = data[0];
                        const update = data.slice(1);

                        newDoc.mux(() => {
                            switch (messageType) {
                                case messageSync:
                                    Y.applyUpdate(newDoc, update, PULSAR_ORIGIN);
                                    break;
                                case messageAwareness:
                                    awarenessProtocol.applyAwarenessUpdate(newDoc.awareness, update, PULSAR_ORIGIN);
                                    break;
                            }
                        });
                        await consumer.acknowledge(receivedMsg);
                    } catch (error) {
                        if (await consumer.isConnected()) {
                            console.error(`[${newDoc.name}]-PULSAR-CONSUMER: error`, error);
                        } else {
                            console.log(`[${newDoc.name}]-PULSAR-CONSUMER: disconnected, exiting loop.`);
                        }
                        break;
                    }
                }
            })();

            return newDoc; // Success
        } catch (err) {
            console.error(`[${docName}] Attempt ${attempt} failed to initialize Pulsar resources:`, err);
            if (attempt < MAX_RETRIES) {
                await reconnectPulsarClient(pulsarClientContainer, pulsarConfig);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retrying
            } else {
                await newDoc.destroy();
                throw new Error(`Failed to initialize Pulsar for ${docName} after ${MAX_RETRIES} attempts.`);
            }
        }
    }
    throw new Error(`Unexpected error in getYDoc after all retries for doc: ${docName}`);
};

export const onMessage = (conn: ws.WebSocket, doc: YDoc, message: Uint8Array) => {
    const encoder = encoding.createEncoder();
    try {
        if (message.length === 0) {
            console.warn(`[${doc.name}] Received empty message, ignoring`);
            return;
        }
        
        const decoder = decoding.createDecoder(message);
        const messageType = decoding.readVarUint(decoder);
        switch (messageType) {
            case messageSync:
                encoding.writeVarUint(encoder, messageSync);
                syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
                if (encoding.length(encoder) > 1) {
                    send(doc, conn, encoding.toUint8Array(encoder));
                } else {
                    // Client is synced
                    const syncDoneEncoder = encoding.createEncoder();
                    encoding.writeVarUint(syncDoneEncoder, messageSync);
                    syncProtocol.writeSyncStep2(syncDoneEncoder, doc, new Uint8Array()); // Empty update
                    send(doc, conn, encoding.toUint8Array(syncDoneEncoder));
                }
                break;
            case messageAwareness:
                awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
                break;
            default:
                console.warn(`[${doc.name}] Unknown message type: ${messageType}`);
        }
    } catch (err) {
        console.error(`[${doc.name}] Error processing message:`, err);
        // Don't destroy the document, just close this connection
        conn.close(1003, 'Invalid message format');
    }
};

export const onConnection = (conn: ws.WebSocket, doc: YDoc) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder));
    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
        const awarenessEncoder = encoding.createEncoder();
        encoding.writeVarUint(awarenessEncoder, messageAwareness);
        encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())));
        send(doc, conn, encoding.toUint8Array(awarenessEncoder));
    }
};

export const setupWSConnection = async (conn: ws.WebSocket, req: http.IncomingMessage, { pulsarClientContainer, pulsarConfig }: { pulsarClientContainer: PulsarClientContainer, pulsarConfig: ServerConfig }) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const docName = url.searchParams.get('doc') || req.url!.slice(1).split('?')[0];

    try {
        const doc = await getYDoc(docName, pulsarClientContainer, pulsarConfig);
        doc.conns.set(conn, new Set());

        conn.binaryType = 'arraybuffer';
        conn.on('message', (message: ArrayBuffer) => onMessage(conn, doc, new Uint8Array(message)));

        conn.on('close', () => onClose(conn, doc));

        let pongReceived = true;
        const pingInterval = setInterval(() => {
            if (!pongReceived) {
                conn.terminate();
                clearInterval(pingInterval);
            }
            pongReceived = false;
            conn.ping();
        }, pingTimeout);

        conn.on('pong', () => {
            pongReceived = true;
        });

        onConnection(conn, doc);
    } catch (err) {
        console.error(`[${docName}] Error setting up connection`, err);
        conn.close(1011, 'Internal Server Error');
    }
};
