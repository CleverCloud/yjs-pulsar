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
            await new Promise(resolve => serverInstance.wss.close(resolve));
            await new Promise(resolve => serverInstance.server.close(resolve));
            await serverInstance.pulsar.close();
        });

        let provider1: WebsocketProvider, provider2: WebsocketProvider;
        afterEach(() => {
            provider1?.destroy();
            provider2?.destroy();
        });

        test('should sync updates between two clients', async () => {

            const doc1 = new Y.Doc();

            provider1 = new WebsocketProvider(`ws://localhost:${port}`, docName, doc1, { WebSocketPolyfill: require('ws') });


            const doc2 = new Y.Doc();

            provider2 = new WebsocketProvider(`ws://localhost:${port}`, docName, doc2, { WebSocketPolyfill: require('ws') });


            try {

                await new Promise(resolve => provider1.once('sync', resolve));

                await new Promise(resolve => provider2.once('sync', resolve));


                const array1 = doc1.getArray('test-array');
                const array2 = doc2.getArray('test-array');

                const updatePromise = new Promise(resolve => {
                    array2.observe(event => {

                        resolve(event);
                    });
                });


                array1.insert(0, ['hello']);

                await updatePromise;


                expect(array2.toJSON()).toEqual(['hello']);
            } finally {

            }
        });
    });
});

