import Pulsar from 'pulsar-client';
import * as Y from 'yjs';
import { startWorker, WorkerConfig } from '../../src/worker';

// Mock the getStorage function to return a mock storage object
const mockStoreUpdate = jest.fn();
jest.mock('../../src/storage', () => ({
  getStorage: () => ({
    storeUpdate: mockStoreUpdate,
  }),
}));

// Mock the Pulsar client
const mockAcknowledge = jest.fn();
const mockReceive = jest.fn();
const mockSubscribe = jest.fn(() =>
  Promise.resolve({
    receive: mockReceive,
    acknowledge: mockAcknowledge,
  })
);

jest.mock('pulsar-client', () => ({
  Client: jest.fn(() => ({
    subscribe: mockSubscribe,
    close: jest.fn(),
  })),
  AuthenticationToken: jest.fn(),
}));

describe('Worker', () => {
  beforeEach(() => {
    // Clear mock function calls before each test
    mockStoreUpdate.mockClear();
    mockAcknowledge.mockClear();
    mockReceive.mockClear();
    mockSubscribe.mockClear();
  });

  const baseConfig: WorkerConfig = {
    pulsarUrl: 'pulsar://localhost:6650',
    pulsarTenant: 'test-tenant',
    pulsarNamespace: 'test-namespace',
    pulsarTopicPrefix: 'yjs-doc-',
    pulsarSubscription: 'yjs-worker-subscription',
  };

  it('should receive a message, store the update, and acknowledge it', (done) => {
    const documentName = 'test-doc';
    const topicName = `persistent://${baseConfig.pulsarTenant}/${baseConfig.pulsarNamespace}/${baseConfig.pulsarTopicPrefix}${documentName}`;
    const ydoc = new Y.Doc();
    const update = Y.encodeStateAsUpdate(ydoc);
    const mockMessage = {
      getTopicName: () => topicName,
      getData: () => Buffer.from(update),
    };

    mockReceive.mockResolvedValueOnce(mockMessage);
    mockReceive.mockImplementationOnce(() => new Promise(() => {})); // Prevent infinite loop

    startWorker(baseConfig).catch(done); // Start worker and catch any unexpected errors

    // Wait for async operations to complete and then assert
    setTimeout(() => {
      try {
        expect(mockStoreUpdate).toHaveBeenCalledWith(documentName, Buffer.from(update));
        expect(mockAcknowledge).toHaveBeenCalledWith(mockMessage);
        done();
      } catch (error) {
        done(error);
      }
    }, 100);
  });

  it('should throw an error if configuration is missing required fields', async () => {
    const incompleteConfig = { ...baseConfig, pulsarTenant: '' };

    await expect(startWorker(incompleteConfig)).rejects.toThrow(
      'PULSAR_TENANT and PULSAR_NAMESPACE must be provided in the configuration'
    );
  });
});
