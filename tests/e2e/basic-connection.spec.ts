import 'dotenv/config';
import { startServer, ServerConfig } from '../../src/server';
import { YjsPulsarServer } from '../../src/types';
import { resetStorage } from '../../src/server/utils';
import WebSocket from 'ws';
import { AddressInfo } from 'net';

describe('Basic Connection E2E', () => {
  const requiredEnv = ['ADDON_PULSAR_BINARY_URL', 'ADDON_PULSAR_TOKEN', 'ADDON_PULSAR_TENANT', 'ADDON_PULSAR_NAMESPACE'];
  const missingEnv = requiredEnv.filter(env => !process.env[env]);

  (missingEnv.length > 0 ? describe.skip : describe)('Basic connection tests with real Pulsar', () => {
    let serverInstance: YjsPulsarServer;
    let port: number;
    const docName = `basic-test-doc-${Date.now()}`;

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

    test('should establish WebSocket connection', async () => {
      const ws = new WebSocket(`ws://localhost:${port}/${docName}`);
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        ws.on('open', () => {
          clearTimeout(timeout);
          resolve();
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    }, 15000);

    test('should receive initial sync message', async () => {
      const ws = new WebSocket(`ws://localhost:${port}/${docName}`);
      
      const messages: Buffer[] = [];
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Message timeout'));
        }, 10000);

        ws.on('open', () => {
          console.log('WebSocket opened');
        });

        ws.on('message', (data: Buffer) => {
          console.log('Received message:', data.length, 'bytes');
          messages.push(data);
          clearTimeout(timeout);
          resolve();
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      expect(messages.length).toBeGreaterThan(0);
      ws.close();
    }, 15000);
  });
});