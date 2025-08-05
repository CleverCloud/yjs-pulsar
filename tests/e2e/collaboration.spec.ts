import 'dotenv/config';
import { startServer, ServerConfig } from '../../src/server';
import { YjsPulsarServer } from '../../src/types';
import { resetStorage } from '../../src/server/utils';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Server } from 'http';
import { AddressInfo } from 'net';

const createSyncedProvider = (port: number, docName: string): Promise<WebsocketProvider> => {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://localhost:${port}`, docName, doc, { WebSocketPolyfill: require('ws') });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Sync timeout'));
    }, 10000);
    
    provider.on('sync', (isSynced: boolean) => {
      clearTimeout(timeout);
      if (isSynced) {
        resolve(provider);
      } else {
        reject(new Error('Failed to sync'));
      }
    });
    
    provider.on('connection-error', () => {
      clearTimeout(timeout);
      reject(new Error('Connection error'));
    });
  });
};

const waitForUpdate = (doc: Y.Doc): Promise<void> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Update timeout'));
    }, 10000);
    
    doc.on('update', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
};

describe('Yjs Pulsar E2E Collaboration', () => {
  const requiredEnv = ['ADDON_PULSAR_BINARY_URL', 'ADDON_PULSAR_TOKEN', 'ADDON_PULSAR_TENANT', 'ADDON_PULSAR_NAMESPACE'];
  const missingEnv = requiredEnv.filter(env => !process.env[env]);

  (missingEnv.length > 0 ? describe.skip : describe)('E2E tests with real Pulsar', () => {
    let serverInstance: YjsPulsarServer;
    let port: number;
    let provider1: WebsocketProvider | null = null;
    let provider2: WebsocketProvider | null = null;
    const docName = `e2e-test-doc-${Date.now()}`;

    beforeAll(async () => {
      resetStorage();
      process.env.STORAGE_TYPE = 'none';

      const config: ServerConfig = {
        port: 0,
        pulsarUrl: process.env.ADDON_PULSAR_BINARY_URL!,
        pulsarToken: process.env.ADDON_PULSAR_TOKEN!,
        pulsarTenant: process.env.ADDON_PULSAR_TENANT!,
        pulsarNamespace: process.env.ADDON_PULSAR_NAMESPACE!,
        pulsarTopicPrefix: process.env.PULSAR_TOPIC_PREFIX || 'yjs-doc-',
      };
      serverInstance = await startServer(config);
      const address = serverInstance.httpServer.address() as AddressInfo;
      port = address.port;
    });

    afterAll(async () => {
      if (serverInstance) {
        await serverInstance.stop();
      }
      resetStorage();
    });

    afterEach(() => {
      provider1?.destroy();
      provider2?.destroy();
    });

    test('should sync updates between two clients', async () => {
      try {
        [provider1, provider2] = await Promise.all([
          createSyncedProvider(port, docName),
          createSyncedProvider(port, docName),
        ]);

        const array1 = provider1.doc.getArray('test-array');
        const array2 = provider2.doc.getArray('test-array');

        const updatePromise = waitForUpdate(provider2.doc);

        array1.insert(0, ['hello']);

        await updatePromise;

        expect(array2.toJSON()).toEqual(['hello']);
      } finally {
        if (provider1) {
          provider1.destroy();
          provider1 = null;
        }
        if (provider2) {
          provider2.destroy();
          provider2 = null;
        }
      }
    }, 30000);
  });
});