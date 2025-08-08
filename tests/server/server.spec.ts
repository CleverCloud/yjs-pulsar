import { startServer, ServerConfig, YjsPulsarServer } from '../../src/server';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { AddressInfo } from 'net';

jest.mock('pulsar-client', () => {
  const Pulsar = jest.requireActual('pulsar-client');

  const mockProducer = {
    send: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue(undefined),
  };

  const mockConsumer = {
    receive: jest.fn(() => new Promise((_, reject) => {
      setTimeout(() => reject(new Error('No messages')), 100);
    })),
    acknowledge: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockResolvedValue(true), // Should return Promise<boolean>
  };

  const mockClient = {
    createProducer: jest.fn().mockResolvedValue(mockProducer),
    subscribe: jest.fn().mockResolvedValue(mockConsumer),
    close: jest.fn().mockResolvedValue(undefined),
  };

  return { ...Pulsar, Client: jest.fn(() => mockClient) };
});

describe('Yjs Pulsar Server Integration', () => {
  let serverInstance: YjsPulsarServer | null = null;
  let port: number;
  const docName = 'test-doc';

  beforeAll(async () => {
    const config: ServerConfig = {
      port: 0,
      pulsarUrl: 'pulsar://localhost:6650',
      pulsarTenant: 'public',
      pulsarNamespace: 'default',
      pulsarTopicPrefix: 'yjs-doc-',
    };
    serverInstance = await startServer(config);
    const address = serverInstance.httpServer.address() as AddressInfo;
    port = address.port;
  });

  afterAll(async () => {
    if (serverInstance) {
      try {
        await serverInstance.stop();
      } catch (error: any) {
        // Ignore errors during test cleanup
        console.warn('Error during test cleanup:', error.message);
      }
    }
  }, 10000); // Increase timeout for cleanup

  const createSyncedProvider = (doc: Y.Doc): Promise<WebsocketProvider> => {
    const provider = new WebsocketProvider(`ws://localhost:${port}`, docName, doc, { WebSocketPolyfill: require('ws') });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Sync timeout'));
      }, 10000); // Increased timeout
      
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
      }, 10000); // Increased timeout
      
      doc.on('update', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  };

  test('should sync updates between two clients', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    let provider1: WebsocketProvider | null = null;
    let provider2: WebsocketProvider | null = null;

    try {
      [provider1, provider2] = await Promise.all([
        createSyncedProvider(doc1),
        createSyncedProvider(doc2),
      ]);

      const array1 = doc1.getArray('test-array');
      const array2 = doc2.getArray('test-array');

      const updatePromise = waitForUpdate(doc2);

      array1.insert(0, ['hello']);

      await updatePromise;

      expect(array2.toJSON()).toEqual(['hello']);
    } finally {
      if (provider1) {
        provider1.destroy();
      }
      if (provider2) {
        provider2.destroy();
      }
      doc1.destroy();
      doc2.destroy();
    }
  }, 10000);
});