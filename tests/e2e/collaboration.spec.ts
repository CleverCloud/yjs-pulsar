import { startServer, ServerConfig } from '../../src/server';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Server } from 'http';
import { AddressInfo } from 'net';
import dotenv from 'dotenv';

dotenv.config();

describe('Yjs Pulsar E2E Collaboration', () => {
    jest.setTimeout(60000);
    let serverInstance: { server: Server, wss: any, pulsar: any };
    let port: number;
    const docName = `e2e-test-doc-${Date.now()}`;

    const pulsarToken = process.env.ADDON_PULSAR_TOKEN;
    const shouldSkip = !pulsarToken || pulsarToken === 'YOUR_PULSAR_AUTHENTICATION_TOKEN';

    (shouldSkip ? describe.skip : describe)('E2E tests with real Pulsar', () => {
        beforeAll(async () => {
            const config: ServerConfig = {
                port: 0, // Use 0 to get a random free port
                pulsarUrl: process.env.ADDON_PULSAR_BINARY_URL!,
                pulsarToken: process.env.ADDON_PULSAR_TOKEN!,
                pulsarTenant: process.env.ADDON_PULSAR_TENANT!,
                pulsarNamespace: process.env.ADDON_PULSAR_NAMESPACE!,
                pulsarTopicPrefix: process.env.PULSAR_TOPIC_PREFIX || 'yjs-doc-',
            };
            serverInstance = await startServer(config);
            const address = serverInstance.server.address() as AddressInfo;
            port = address.port;
        });

        afterAll(async () => {
            // Gracefully close all client connections before shutting down the server
            for (const ws of serverInstance.wss.clients) {
                ws.close();
            }
            await new Promise(resolve => serverInstance.wss.close(resolve));
            await new Promise(resolve => serverInstance.server.close(resolve));
            if (serverInstance.pulsar) {
                await serverInstance.pulsar.close();
            }
        });



        let provider1: WebsocketProvider | null, provider2: WebsocketProvider | null;

        afterEach(() => {
            provider1?.destroy();
            provider2?.destroy();
            provider1 = null;
            provider2 = null;
        });

        const waitForSync = (provider: WebsocketProvider) => {
            return new Promise((resolve, reject) => {
                provider.once('sync', (isSynced: boolean) => {
                    if (isSynced) {
                        resolve(true);
                    } else {
                        reject(new Error('Sync failed'));
                    }
                });

                const ws = provider.ws as any;
                if (ws) {
                    ws.addEventListener('close', (event: any) => {
                        reject(new Error(`WebSocket closed unexpectedly with code: ${event.code}`));
                    });
                }
            });
        };

        test('should sync updates between two clients', async () => {
            provider1 = new WebsocketProvider(`ws://localhost:${port}`, docName, new Y.Doc(), { WebSocketPolyfill: require('ws') });
            provider2 = new WebsocketProvider(`ws://localhost:${port}`, docName, new Y.Doc(), { WebSocketPolyfill: require('ws') });

            const doc1 = provider1.doc;
            const array1 = doc1.getArray('test-array');
            const doc2 = provider2.doc;
            const array2 = doc2.getArray('test-array');

            await Promise.all([waitForSync(provider1), waitForSync(provider2)]);

            const updatePromise = new Promise(resolve => {
                array2.observe(event => {
                    resolve(event);
                });
            });

            array1.insert(0, ['hello']);
            await updatePromise;

            expect(array2.toJSON()).toEqual(['hello']);
        });
    });
});

