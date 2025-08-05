import http from 'http';
import { startServer, ServerConfig } from '../../src/server';
import { resetStorage } from '../../src/server/utils';
import { AuthStrategy, VerifyClientDoneCallback, YjsPulsarServer } from '../../src/types';
import WebSocket from 'ws';
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
    isConnected: jest.fn(() => false),
  };

  const mockClient = {
    createProducer: jest.fn().mockResolvedValue(mockProducer),
    subscribe: jest.fn().mockResolvedValue(mockConsumer),
    close: jest.fn().mockResolvedValue(undefined),
  };

  return { ...Pulsar, Client: jest.fn(() => mockClient) };
});

class TokenAuthStrategy implements AuthStrategy {
  constructor(private validToken: string) {}

  verifyClient(info: { origin: string; secure: boolean; req: http.IncomingMessage }, done: VerifyClientDoneCallback): void {
    const token = new URL(info.req.url!, `http://${info.req.headers.host}`).searchParams.get('token');
    if (token === this.validToken) {
      done(true);
    } else {
      done(false, 401, 'Unauthorized');
    }
  }
}

describe('WebSocket Server Authentication', () => {
  let serverInstance: YjsPulsarServer | null = null;
  let port: number;

  const startTestServer = async (config: Partial<ServerConfig> = {}) => {
    const defaultConfig: Omit<ServerConfig, 'port'> = {
      pulsarUrl: 'pulsar://localhost:6650',
      pulsarTenant: 'public',
      pulsarNamespace: 'default',
      pulsarTopicPrefix: 'yjs-test',
    };
    serverInstance = await startServer({ ...defaultConfig, port: 0, ...config });
    const address = serverInstance.httpServer.address() as AddressInfo;
    port = address.port;
  };

  beforeEach(() => {
    resetStorage();
    process.env.STORAGE_TYPE = 'none';
  });

  afterEach(async () => {
    await serverInstance?.stop();
  });

  const connect = (url: string): Promise<WebSocket> => {
    const ws = new WebSocket(url);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 5000);
      
      ws.on('open', () => {
        clearTimeout(timeout);
        resolve(ws);
      });
      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  };

  const connectAndExpectClose = (url: string): Promise<number> => {
    const ws = new WebSocket(url);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Close timeout'));
      }, 5000);
      
      ws.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
  };

  it('should allow connection when no auth strategy is provided', async () => {
    await startTestServer();
    const ws = await connect(`ws://localhost:${port}/test-doc`);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  }, 10000);

  it('should allow connection with a valid token', async () => {
    const strategy = new TokenAuthStrategy('secret-token');
    await startTestServer({ auth: strategy });
    const ws = await connect(`ws://localhost:${port}/test-doc?token=secret-token`);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  }, 10000);

  it('should reject connection with an invalid token', async () => {
    const strategy = new TokenAuthStrategy('secret-token');
    await startTestServer({ auth: strategy });
    await expect(connect(`ws://localhost:${port}/test-doc?token=invalid-token`)).rejects.toThrow('Unexpected server response: 401');
  }, 10000);

  it('should reject connection with no token when one is required', async () => {
    const strategy = new TokenAuthStrategy('secret-token');
    await startTestServer({ auth: strategy });
    await expect(connect(`ws://localhost:${port}/test-doc`)).rejects.toThrow('Unexpected server response: 401');
  }, 10000);
});