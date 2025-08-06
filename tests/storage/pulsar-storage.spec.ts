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
  const SNAPSHOT_INTERVAL = 30;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Mock Pulsar client
    mockClient = {
      createReader: jest.fn(),
      createProducer: jest.fn(),
      close: jest.fn(),
    } as any;

    // Mock S3Storage
    mockS3Storage = new S3Storage() as jest.Mocked<S3Storage>;
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
      const mockState = new Uint8Array([1, 2, 3, 4, 5]);
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

      // Mock reader that returns exactly SNAPSHOT_INTERVAL messages
      const mockMessages = Array(SNAPSHOT_INTERVAL).fill(null).map((_, i) => ({
        getMessageId: () => ({ toString: () => `msg-id-${i}` }),
        getData: () => new Uint8Array([0, i + 1]) // messageType 0 (sync), data i+1
      }));

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
      const mockSnapshot = {
        state: [1, 2, 3],
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
      const state = new Uint8Array([1, 2, 3]);
      
      // storeDoc in PulsarStorage just logs since Pulsar handles persistence
      await expect(pulsarStorage.storeDoc(docName, state)).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle S3 snapshot load failure gracefully', async () => {
      const docName = 'test-doc';
      
      // S3 fails to load snapshot
      mockS3Storage.getDoc.mockRejectedValue(new Error('S3 Error'));

      // But Pulsar reader works
      const mockReader = {
        readNext: jest.fn()
          .mockResolvedValueOnce({
            getMessageId: () => ({ toString: () => 'msg-1' }),
            getData: () => new Uint8Array([0, 1])
          })
          .mockRejectedValue(new Error('Timeout')),
        close: jest.fn(),
      };
      mockClient.createReader.mockResolvedValue(mockReader as any);

      const result = await pulsarStorage.getDoc(docName);

      // Should still work without snapshot
      expect(result).not.toBeNull();
      expect(mockClient.createReader).toHaveBeenCalledWith(
        expect.objectContaining({
          startMessageId: expect.anything() // Should use earliest
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

      // Mock reader that could return more than SNAPSHOT_INTERVAL messages
      let callCount = 0;
      const mockReader = {
        readNext: jest.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve({
            getMessageId: () => ({ toString: () => `msg-${callCount}` }),
            getData: () => new Uint8Array([0, callCount])
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