import { startServer, ServerConfig } from '../../src/server';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Server } from 'http';
import { AddressInfo } from 'net';

// In-memory message bus to mock Pulsar topics
const messageBus = new Map<string, { messages: any[], waitingResolvers: Function[] }>();

function getTopicBus(topic: string) {
    if (!messageBus.has(topic)) {
        messageBus.set(topic, { messages: [], waitingResolvers: [] });
    }
    return messageBus.get(topic)!;
}

jest.mock('pulsar-client', () => {
    const Pulsar = jest.requireActual('pulsar-client');

    const mockProducer = jest.fn(function(this: any, config: { topic: string }) {
        this.topic = config.topic;
        this.send = jest.fn(({ data }: { data: Buffer }) => {

            const bus = getTopicBus(this.topic);
            const message = { getData: () => data, getTopicName: () => this.topic };
            if (bus.waitingResolvers.length > 0) {
                bus.waitingResolvers.shift()!(message);
            } else {
                bus.messages.push(message);
            }
            return Promise.resolve();
        });
        this.close = jest.fn().mockResolvedValue(undefined);
        this.flush = jest.fn().mockResolvedValue(undefined);
    });

    const mockConsumer = jest.fn(function(this: any, config: { topic: string }) {
        this.topic = config.topic;
        let connected = true;
        this.isConnected = jest.fn(() => connected);
        this.receive = jest.fn(() => {
            console.log(`[MOCK PULSAR] Consumer listening on ${this.topic}`);
            return new Promise(resolve => {
                if (!connected) {
                    resolve(new Error('Consumer closed'));
                    return;
                }
                const bus = getTopicBus(this.topic);
                if (bus.messages.length > 0) {
                    resolve(bus.messages.shift());
                } else {
                    bus.waitingResolvers.push(resolve);
                }
            });
        });
        this.acknowledge = jest.fn();
        this.close = jest.fn(() => {
            connected = false;
            const bus = getTopicBus(this.topic);
            while (bus.waitingResolvers.length > 0) {
                bus.waitingResolvers.shift()!(new Error('Consumer closed'));
            }
            return Promise.resolve();
        });
    });

    const mockClient = {
        createProducer: jest.fn().mockImplementation(config => Promise.resolve(new mockProducer(config))),
        subscribe: jest.fn().mockImplementation(config => Promise.resolve(new mockConsumer(config))),
        close: jest.fn(() => {
            console.log('[MOCK PULSAR] Client closing');
            return Promise.resolve();
        }),
    };

    return { ...Pulsar, Client: jest.fn(() => mockClient) };
});

describe('Yjs Pulsar Server Integration', () => {
    let serverInstance: { server: Server, wss: any, pulsar: any };
    let port: number;
    const docName = 'test-doc';

    beforeAll(async () => {
        console.log('[TEST] beforeAll: Starting server...');
        const config: ServerConfig = {
            port: 0, // Use 0 to get a random free port
            pulsarUrl: 'pulsar://localhost:6650',
            pulsarTenant: 'public',
            pulsarNamespace: 'default',
            pulsarTopicPrefix: 'yjs-doc-',
        };
        serverInstance = await startServer(config);
        const address = serverInstance.server.address() as AddressInfo;
        port = address.port;
        console.log(`[TEST] beforeAll: Server started on port ${port}`);
    });

    afterAll(async () => {
        console.log('[TEST] afterAll: Starting shutdown...');
        await serverInstance.pulsar.close();
        serverInstance.wss.close();
        await new Promise(resolve => serverInstance.server.close(resolve));
        messageBus.clear();
        console.log('[TEST] afterAll: Shutdown complete.');
    });

    test('should sync updates between two clients', async () => {
        const testExecution = async () => {
            console.log('[TEST] Running test: should sync updates between two clients');
            const doc1 = new Y.Doc();
            const provider1 = new WebsocketProvider(`ws://localhost:${port}`, docName, doc1, { WebSocketPolyfill: require('ws') });
            provider1.on('status', (event: any) => console.log(`[PROVIDER 1] Status: ${event.status}`))
            const array1 = doc1.getArray('test-array');
    
            const doc2 = new Y.Doc();
            const provider2 = new WebsocketProvider(`ws://localhost:${port}`, docName, doc2, { WebSocketPolyfill: require('ws') });
            provider2.on('status', (event: any) => console.log(`[PROVIDER 2] Status: ${event.status}`))
            const array2 = doc2.getArray('test-array');
    
            try {
                console.log('[TEST] Waiting for provider 2 to sync...');
                await new Promise(resolve => provider2.on('sync', (isSynced: boolean) => {
                    if (isSynced) {
                        console.log('[TEST] Provider 2 synced.');
                        resolve(true);
                    }
                }));
    
                const updatePromise = new Promise(resolve => {
                    array2.observe(() => {
                        console.log('[TEST] Received update on doc2');
                        expect(array2.toArray()).toEqual(['hello']);
                        resolve(true);
                    });
                });
    
                console.log('[TEST] Pushing update to doc1...');
                array1.push(['hello']);
    
                await updatePromise;
                console.log('[TEST] Update confirmed.');
            } finally {
                console.log('[TEST] Finally block: Disconnecting providers...');
                provider1.disconnect();
                provider2.disconnect();
                console.log('[TEST] Providers disconnected.');
            }
        };

        const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
            const timeout = new Promise<T>((_, reject) =>
                setTimeout(() => reject(new Error(`Test timed out after ${ms}ms`)), ms)
            );
            return Promise.race([promise, timeout]);
        };

        await withTimeout(testExecution(), 5000);
    }, 10000);
});
