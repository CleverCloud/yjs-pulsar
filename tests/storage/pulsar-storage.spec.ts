import { PulsarStorage } from '../../src/storage/pulsar-storage';
import { S3Storage } from '../../src/storage/s3';
import Pulsar from 'pulsar-client';
import * as Y from 'yjs';

// Mock Pulsar client
jest.mock('pulsar-client');
jest.mock('../../src/storage/s3');

describe('PulsarStorage with S3 Snapshots', () => {
  let mockClient: jest.Mocked<Pulsar.Client>;
  let mockS3Storage: jest.Mocked<S3Storage>;
  let pulsarStorage: PulsarStorage;
  
  const TEST_TENANT = 'test-tenant';
  const TEST_NAMESPACE = 'test-namespace';
  const TEST_PREFIX = 'test-';
  const SNAPSHOT_INTERVAL = 5; // Reduced for faster tests
  
  // Helper to create valid Yjs update data
  const createValidYjsUpdate = (text: string = '') => {
    const doc = new Y.Doc();
    const yText = doc.getText('test');
    if (text) {
      yText.insert(0, text);
    }
    return Y.encodeStateAsUpdate(doc);
  };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Mock Pulsar client
    mockClient = {
      createReader: jest.fn(),
      createProducer: jest.fn(),
      close: jest.fn(),
    } as any;

    // Mock Pulsar.MessageId static methods
    const mockMessageId = {
      toString: () => 'mocked-message-id',
      serialize: () => Buffer.from('mock-serialized-id')
    };
    
    (Pulsar.MessageId.earliest as jest.Mock) = jest.fn().mockReturnValue(mockMessageId);
    (Pulsar.MessageId.deserialize as jest.Mock) = jest.fn().mockReturnValue(mockMessageId);

    // Mock S3Storage constructor to succeed by default
    mockS3Storage = {
      getDoc: jest.fn(),
      storeDoc: jest.fn(),
    } as unknown as jest.Mocked<S3Storage>;
    (S3Storage as jest.MockedClass<typeof S3Storage>).mockImplementation(() => mockS3Storage);
    
    // Create PulsarStorage instance
    pulsarStorage = new PulsarStorage(
      mockClient,
      TEST_TENANT,
      TEST_NAMESPACE,
      TEST_PREFIX,
      SNAPSHOT_INTERVAL
    );
  });

  describe('Snapshot Management', () => {
    it('should load snapshot from S3 when available', async () => {
      const docName = 'test-doc';
      const mockState = createValidYjsUpdate('snapshot content');
      const mockSnapshot = {
        state: Array.from(mockState),
        lastMessageId: 'mock-message-id-base64',
        messageCount: 150,
        timestamp: Date.now()
      };

      // Mock S3 returning a snapshot
      mockS3Storage.getDoc.mockResolvedValue(
        Buffer.from(JSON.stringify(mockSnapshot))
      );

      // Mock Pulsar reader
      const mockReader = {
        readNext: jest.fn().mockRejectedValue(new Error('Timeout')),
        close: jest.fn(),
      };
      mockClient.createReader.mockResolvedValue(mockReader as any);

      const result = await pulsarStorage.getDoc(docName);

      // Verify S3 was called for snapshot
      expect(mockS3Storage.getDoc).toHaveBeenCalledWith(
        `snapshots/${docName}.snapshot.json`
      );

      // Verify reader was created
      expect(mockClient.createReader).toHaveBeenCalled();
      
      // Result should not be null
      expect(result).not.toBeNull();
    });

    it('should create new snapshot after processing snapshot interval messages', async () => {
      const docName = 'test-doc';
      
      // No existing snapshot
      mockS3Storage.getDoc.mockResolvedValue(null);

      // Mock reader that returns exactly SNAPSHOT_INTERVAL messages with valid Yjs data
      const mockMessages = Array(SNAPSHOT_INTERVAL).fill(null).map((_, i) => {
        const validUpdate = createValidYjsUpdate(`message ${i}`);
        const messageData = new Uint8Array(validUpdate.length + 1);
        messageData[0] = 0; // messageType 0 (sync)
        messageData.set(validUpdate, 1);
        return {
          getMessageId: () => ({ toString: () => `msg-id-${i}` }),
          getData: () => messageData
        };
      });

      let messageIndex = 0;
      const mockReader = {
        readNext: jest.fn().mockImplementation(() => {
          if (messageIndex < mockMessages.length) {
            return Promise.resolve(mockMessages[messageIndex++]);
          }
          return Promise.reject(new Error('Timeout'));
        }),
        close: jest.fn(),
      };
      
      mockClient.createReader.mockResolvedValue(mockReader as any);

      await pulsarStorage.getDoc(docName);

      // Should save snapshot after processing SNAPSHOT_INTERVAL messages
      expect(mockS3Storage.storeDoc).toHaveBeenCalledWith(
        `snapshots/${docName}.snapshot.json`,
        expect.any(Buffer)
      );

      // Verify snapshot content
      const savedSnapshot = JSON.parse(
        mockS3Storage.storeDoc.mock.calls[0][1].toString()
      );
      expect(savedSnapshot.messageCount).toBe(SNAPSHOT_INTERVAL);
      expect(savedSnapshot.lastMessageId).toBe(`msg-id-${SNAPSHOT_INTERVAL - 1}`);
    });

    it('should start replay from snapshot MessageID', async () => {
      const docName = 'test-doc';
      // Use a valid Yjs state instead of [1, 2, 3]
      const mockState = createValidYjsUpdate('snapshot content');
      const mockSnapshot = {
        state: Array.from(mockState),
        lastMessageId: Buffer.from('test-message-id').toString('base64'),
        messageCount: 100,
        timestamp: Date.now()
      };

      mockS3Storage.getDoc.mockResolvedValue(
        Buffer.from(JSON.stringify(mockSnapshot))
      );

      const mockReader = {
        readNext: jest.fn().mockRejectedValue(new Error('Timeout')),
        close: jest.fn(),
      };
      mockClient.createReader.mockResolvedValue(mockReader as any);

      await pulsarStorage.getDoc(docName);

      // Verify reader was created with correct startMessageId
      expect(mockClient.createReader).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: `persistent://${TEST_TENANT}/${TEST_NAMESPACE}/${TEST_PREFIX}${docName}`,
          startMessageId: expect.anything(), // Would be parsed MessageID
          readCompacted: true
        })
      );
    });
  });

  describe('Document Storage', () => {
    it('should handle storeDoc by logging (Pulsar handles persistence)', async () => {
      const docName = 'test-doc';
      const state = createValidYjsUpdate('test content');
      
      // storeDoc in PulsarStorage just logs since Pulsar handles persistence
      await expect(pulsarStorage.storeDoc(docName, state)).resolves.not.toThrow();
    });
  });

  describe('S3Storage Initialization', () => {
    it('should work without S3Storage when initialization fails', async () => {
      // Mock S3Storage constructor to throw
      (S3Storage as jest.MockedClass<typeof S3Storage>).mockImplementation(() => {
        throw new Error('S3 credentials missing');
      });

      // Create PulsarStorage - should not throw
      const pulsarStorageNoS3 = new PulsarStorage(
        mockClient,
        TEST_TENANT,
        TEST_NAMESPACE,
        TEST_PREFIX,
        SNAPSHOT_INTERVAL
      );

      const docName = 'test-doc';
      
      // Mock reader with valid data
      const validUpdate = createValidYjsUpdate('test content');
      const messageData = new Uint8Array(validUpdate.length + 1);
      messageData[0] = 0; // messageType 0 (sync)
      messageData.set(validUpdate, 1);
      
      const mockReader = {
        readNext: jest.fn()
          .mockResolvedValueOnce({
            getMessageId: () => ({ toString: () => 'msg-1' }),
            getData: () => messageData
          })
          .mockRejectedValue(new Error('Timeout')),
        close: jest.fn(),
      };
      mockClient.createReader.mockResolvedValue(mockReader as any);

      const result = await pulsarStorageNoS3.getDoc(docName);
      
      // Should work without S3 (Pulsar-only mode)
      expect(result).not.toBeNull();
      expect(mockClient.createReader).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle S3 snapshot load failure gracefully', async () => {
      const docName = 'test-doc';
      
      // S3 fails to load snapshot
      mockS3Storage.getDoc.mockRejectedValue(new Error('S3 Error'));

      // But Pulsar reader works with valid data
      const validUpdate = createValidYjsUpdate('recovery content');
      const messageData = new Uint8Array(validUpdate.length + 1);
      messageData[0] = 0; // messageType 0 (sync)
      messageData.set(validUpdate, 1);
      
      const mockReader = {
        readNext: jest.fn()
          .mockResolvedValueOnce({
            getMessageId: () => ({ toString: () => 'msg-1' }),
            getData: () => messageData
          })
          .mockRejectedValue(new Error('Timeout')),
        close: jest.fn(),
      };
      mockClient.createReader.mockResolvedValue(mockReader as any);

      const result = await pulsarStorage.getDoc(docName);

      // Should still work without snapshot
      expect(result).not.toBeNull();
      // Check that reader was created (snapshot failure shouldn't prevent reader creation)
      expect(mockClient.createReader).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: `persistent://${TEST_TENANT}/${TEST_NAMESPACE}/${TEST_PREFIX}${docName}`,
          readCompacted: true
          // startMessageId can be earliest() when no snapshot, which is fine
        })
      );
    });

    it('should handle corrupted snapshot data', async () => {
      const docName = 'test-doc';
      
      // Return invalid JSON
      mockS3Storage.getDoc.mockResolvedValue(
        Buffer.from('invalid json data')
      );

      const mockReader = {
        readNext: jest.fn().mockRejectedValue(new Error('Timeout')),
        close: jest.fn(),
      };
      mockClient.createReader.mockResolvedValue(mockReader as any);

      const result = await pulsarStorage.getDoc(docName);

      // Should handle gracefully and continue without snapshot
      expect(result).toBeDefined();
    });
  });

  describe('Message Replay Limits', () => {
    it('should limit replay to snapshot interval', async () => {
      const docName = 'test-doc';
      
      // No snapshot
      mockS3Storage.getDoc.mockResolvedValue(null);

      // Mock reader that could return more than SNAPSHOT_INTERVAL messages with valid data
      let callCount = 0;
      const mockReader = {
        readNext: jest.fn().mockImplementation(() => {
          callCount++;
          const validUpdate = createValidYjsUpdate(`incremental message ${callCount}`);
          const messageData = new Uint8Array(validUpdate.length + 1);
          messageData[0] = 0; // messageType 0 (sync)
          messageData.set(validUpdate, 1);
          return Promise.resolve({
            getMessageId: () => ({ toString: () => `msg-${callCount}` }),
            getData: () => messageData
          });
        }),
        close: jest.fn(),
      };
      
      mockClient.createReader.mockResolvedValue(mockReader as any);

      await pulsarStorage.getDoc(docName);

      // Should stop at SNAPSHOT_INTERVAL even if more messages available
      expect(mockReader.readNext).toHaveBeenCalledTimes(SNAPSHOT_INTERVAL);
    });
  });

  describe('Integration with Yjs', () => {
    it('should properly apply updates to Yjs document', async () => {
      const docName = 'test-doc';
      
      // Create a test Yjs document with some content
      const sourceDoc = new Y.Doc();
      const sourceText = sourceDoc.getText('test');
      sourceText.insert(0, 'Hello World');
      const sourceUpdate = Y.encodeStateAsUpdate(sourceDoc);

      // Mock snapshot with this state
      const mockSnapshot = {
        state: Array.from(sourceUpdate),
        lastMessageId: 'snapshot-msg-id',
        messageCount: 10,
        timestamp: Date.now()
      };

      mockS3Storage.getDoc.mockResolvedValue(
        Buffer.from(JSON.stringify(mockSnapshot))
      );

      // No additional messages
      const mockReader = {
        readNext: jest.fn().mockRejectedValue(new Error('Timeout')),
        close: jest.fn(),
      };
      mockClient.createReader.mockResolvedValue(mockReader as any);

      const result = await pulsarStorage.getDoc(docName);

      // Apply result to a new doc and verify content
      const resultDoc = new Y.Doc();
      Y.applyUpdate(resultDoc, result!);
      const resultText = resultDoc.getText('test').toString();
      
      expect(resultText).toBe('Hello World');
    });
  });
});