import { IncomingMessage } from 'http';
import ws from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as mutex from 'lib0/mutex';
import Pulsar from 'pulsar-client';

import { PulsarConfig } from '../types.js';

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

const messageSync = 0;
const messageAwareness = 1;
const PULSAR_ORIGIN = 'pulsar';

const pingTimeout = 30000;

const docs: Map<string, YDoc> = new Map();

// This is a helper function to send a message to a WebSocket connection
const send = (conn: ws.WebSocket, message: Uint8Array) => {

    if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
        conn.close();
        return;
    }
    try {
        conn.send(message, (err) => {
            if (err) {
                conn.close();
            }
        });
    } catch (e) {
        conn.close();
    }
};

const createMessage = (type: number, buffer: Uint8Array): Uint8Array => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, type);
    encoding.writeVarUint8Array(encoder, buffer);
    return encoding.toUint8Array(encoder);
}

class YDoc extends Y.Doc {
    name: string;
    mux: mutex.mutex;
    conns: Map<ws.WebSocket, Set<number>>;
    awareness: awarenessProtocol.Awareness;
    producer: Pulsar.Producer | null = null;
    consumer: Pulsar.Consumer | null = null;

    constructor(name: string) {
        super({ gc: true });
        this.name = name;
        this.mux = mutex.createMutex();
        this.conns = new Map();
        this.awareness = new awarenessProtocol.Awareness(this);

        this.on('update', this.updateHandler.bind(this));
        this.awareness.on('update', this.awarenessHandler.bind(this));
    }

    updateHandler(update: Uint8Array, origin: any) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.writeUpdate(encoder, update);
        const message = encoding.toUint8Array(encoder);

        this.conns.forEach((_, conn) => send(conn, message));

        if (origin !== PULSAR_ORIGIN) {
            this.producer?.send({ data: Buffer.from(message) }).catch(err => {
                console.error(`[${this.name}]-PULSAR-PRODUCER: failed to send message`, err);
            });
        }
    }

    awarenessHandler({ added, updated, removed }: any, origin: any) {
        const changedClients = added.concat(updated, removed);
        const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients);
        const message = createMessage(messageAwareness, awarenessUpdate);

        this.conns.forEach((_, conn) => send(conn, message));

        if (origin !== PULSAR_ORIGIN) {
            this.producer?.send({ data: Buffer.from(message) }).catch(err => {
                console.error(`[${this.name}]-PULSAR-PRODUCER: failed to send awareness`, err);
            });
        }
    }

    async destroy() {
        super.destroy();
        if (this.producer) {
            await this.producer.close().catch(err => console.error('Failed to close producer:', err));
        }
        if (this.consumer) {
            await this.consumer.close().catch(err => console.error('Failed to close consumer:', err));
        }
        docs.delete(this.name);
    }
}

const getYDoc = (docName: string, pulsarClient: Pulsar.Client, pulsarConfig: PulsarConfig): Promise<YDoc> => {
    const existingDoc = docs.get(docName);
    if (existingDoc) {
        return Promise.resolve(existingDoc);
    }

    const newDoc = new YDoc(docName);
    docs.set(docName, newDoc);

    const topic = `persistent://${pulsarConfig.pulsarTenant}/${pulsarConfig.pulsarNamespace}/${pulsarConfig.pulsarTopicPrefix}${docName}`;

    const producerPromise = pulsarClient.createProducer({ topic });
    const consumerPromise = pulsarClient.subscribe({
        topic,
        subscription: `${pulsarConfig.pulsarTopicPrefix}-subscription-${docName}`,
        subscriptionType: 'Shared',
    });

    return new Promise((resolve, reject) => {
        producerPromise.then(producer => {
            newDoc.producer = producer;
            consumerPromise.then(consumer => {
                newDoc.consumer = consumer;
                (async () => {
                    while (await consumer.isConnected()) {
                        try {
                            const receivedMsg = await consumer.receive();
                            const message = receivedMsg.getData();
                            newDoc.mux(() => {
                                const decoder = decoding.createDecoder(message);
                                const messageType = decoding.readVarUint(decoder);

                                switch (messageType) {
                                    case messageSync:
                                        syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), newDoc, PULSAR_ORIGIN);
                                        break;
                                    case messageAwareness:
                                        awarenessProtocol.applyAwarenessUpdate(newDoc.awareness, decoding.readVarUint8Array(decoder), PULSAR_ORIGIN);
                                        break;
                                }
                            });
                            consumer.acknowledge(receivedMsg);
                        } catch (error) {
                            if (consumer.isConnected()) {
                                console.error(`[${newDoc.name}]-PULSAR-CONSUMER: error`, error);
                            } else {
                                console.log(`[${newDoc.name}]-PULSAR-CONSUMER: disconnected, exiting loop.`);
                            }
                            break;
                        }
                    }
                })();
                resolve(newDoc);
            }).catch(async err => {
                console.error(`[${docName}] Failed to subscribe to Pulsar topic`, err);
                await newDoc.destroy();
                reject(err);
            });
        }).catch(async err => {
            console.error(`[${docName}] Failed to create Pulsar producer`, err);
            await newDoc.destroy();
            reject(err);
        });
    });
};

const onMessage = (conn: ws.WebSocket, doc: YDoc, message: Uint8Array) => {
    try {
        const decoder = decoding.createDecoder(message);
        const messageType = decoding.readVarUint(decoder);

        switch (messageType) {
            case messageSync: {
                const encoder = encoding.createEncoder();
                encoding.writeVarUint(encoder, messageSync);
                syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
                if (encoding.length(encoder) > 1) {
                    send(conn, encoding.toUint8Array(encoder));
                }
                break;
            }
            case messageAwareness: {
                awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
                break;
            }
            default:
                console.error('Unknown message type');
        }
    } catch (err) {
        console.error(err);
        closeConn(conn, doc);
    }
};

const closeConn = async (conn: ws.WebSocket, doc: YDoc) => {
    if (doc.conns.has(conn)) {
        const controlledIds = doc.conns.get(conn);
        doc.conns.delete(conn);
        awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds || []), conn);
        if (doc.conns.size === 0) {
            await doc.destroy();
        }
    }
    conn.close();
};

export const setupWSConnection = async (conn: ws.WebSocket, req: IncomingMessage, { docName = req.url!.slice(1).split('?')[0], pulsarClient, pulsarConfig }: { docName?: string, pulsarClient: Pulsar.Client, pulsarConfig: PulsarConfig }) => {

    conn.binaryType = 'arraybuffer';
    try {
        const doc = await getYDoc(docName, pulsarClient, pulsarConfig);
        doc.conns.set(conn, new Set());

        conn.on('message', (message: ArrayBuffer) => onMessage(conn, doc, new Uint8Array(message)));
        conn.on('close', () => { closeConn(conn, doc); });

        let pongReceived = true;
        conn.on('pong', () => {
            pongReceived = true;
        });

        const pingInterval = setInterval(() => {
            if (!pongReceived) {
                if (doc.conns.has(conn)) {
                    closeConn(conn, doc);
                }
                clearInterval(pingInterval);
            } else if (doc.conns.has(conn)) {
                pongReceived = false;
                try {
                    conn.ping();
                } catch (e) {
                    closeConn(conn, doc);
                    clearInterval(pingInterval);
                }
            }
        }, pingTimeout);

        // send sync step 1
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.writeSyncStep1(encoder, doc);
        send(conn, encoding.toUint8Array(encoder));

        // Send awareness update
        const awarenessEncoder = encoding.createEncoder();
        encoding.writeVarUint(awarenessEncoder, messageAwareness);
        encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(doc.awareness.getStates().keys())));
        send(conn, encoding.toUint8Array(awarenessEncoder));
    } catch (err) {
        console.error('Failed to setup connection:', err);
        conn.close();
    }
};
