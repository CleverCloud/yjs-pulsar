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
  const provider = new WebsocketProvider(
    `ws://localhost:${port}`, 
    docName, 
    doc, 
    { 
      WebSocketPolyfill: require('ws'),
      connect: true,
      params: {},
      awareness: undefined,
      resyncInterval: 5000,
      maxBackoffTime: 5000
    }
  );
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      // Don't reject on timeout, just resolve with provider
      // The test will fail if sync doesn't work properly
      console.warn(`Provider sync timeout for ${docName}, continuing anyway`);
      resolve(provider);
    }, 15000); // Increase timeout
    
    let connected = false;
    
    provider.on('status', (event: any) => {
      if (event.status === 'connected' && !connected) {
        connected = true;
        // Give it a bit more time to sync after connection
        setTimeout(() => {
          clearTimeout(timeout);
          resolve(provider);
        }, 500);
      }
    });
    
    provider.on('sync', (isSynced: boolean) => {
      if (isSynced && !connected) {
        clearTimeout(timeout);
        resolve(provider);
      }
    });
    
    provider.on('connection-error', (error: any) => {
      console.error('WebSocket connection error:', error);
      // Don't reject, let the test timeout handle failures
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

  // Always run tests, but provide mock values if env vars are missing
  describe('E2E tests with real Pulsar', () => {
    if (missingEnv.length > 0) {
      // Set mock values for local testing when env vars are missing
      process.env.ADDON_PULSAR_BINARY_URL = process.env.ADDON_PULSAR_BINARY_URL || 'pulsar://localhost:6650';
      process.env.ADDON_PULSAR_TOKEN = process.env.ADDON_PULSAR_TOKEN || 'mock-token';
      process.env.ADDON_PULSAR_TENANT = process.env.ADDON_PULSAR_TENANT || 'public';
      process.env.ADDON_PULSAR_NAMESPACE = process.env.ADDON_PULSAR_NAMESPACE || 'default';
      console.warn('Missing Pulsar env vars, using mock values:', missingEnv);
    }
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
        // Create providers sequentially to avoid race conditions
        provider1 = await createSyncedProvider(port, docName);
        provider2 = await createSyncedProvider(port, docName);
        
        // Wait a bit for both providers to stabilize
        await new Promise(resolve => setTimeout(resolve, 1000));

        const array1 = provider1.doc.getArray('test-array');
        const array2 = provider2.doc.getArray('test-array');

        // Set up update promise before making changes
        const updatePromise = new Promise<void>((resolve) => {
          const checkUpdate = () => {
            if (array2.toJSON().includes('hello')) {
              resolve();
            }
          };
          
          // Check immediately in case it's already there
          checkUpdate();
          
          // Also listen for updates
          const observer = () => {
            checkUpdate();
            if (provider2) {
              provider2.doc.off('update', observer);
            }
          };
          if (provider2) {
            provider2.doc.on('update', observer);
          }
          
          // Timeout fallback
          setTimeout(() => {
            if (provider2) {
              provider2.doc.off('update', observer);
            }
            resolve();
          }, 5000);
        });

        // Make the change
        array1.insert(0, ['hello']);

        // Wait for the update to propagate
        await updatePromise;

        // Verify the result
        expect(array2.toJSON()).toEqual(['hello']);
      } catch (error) {
        console.error('Test failed with error:', error);
        throw error;
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
    }, 60000); // Increase timeout for CI
  });
});