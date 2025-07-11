import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { S3Storage } from '../../src/storage/s3';
import * as Y from 'yjs';
import { Readable } from 'stream';
import { sdkStreamMixin } from '@aws-sdk/util-stream-node';

// Mock the S3 client using a factory to have more control
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  // Import original module to get access to command classes
  const originalModule = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...originalModule,
    S3Client: jest.fn(() => ({
      send: mockSend,
    })),
  };
});

describe('S3Storage', () => {
  let storage: S3Storage;

  beforeEach(() => {
    // Set up environment variables for S3
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_ENDPOINT = 'http://localhost:9000';
    process.env.S3_ACCESS_KEY_ID = 'test-access-key';
    process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';

    // Clear all mocks before each test
    (S3Client as jest.Mock).mockClear();
    mockSend.mockClear();

    storage = new S3Storage();
  });

  it('should store a document snapshot in S3', async () => {
    const documentName = 'snapshot-doc';
    const ydoc = new Y.Doc();
    ydoc.getText('content').insert(0, 'snapshot content');
    const state = Y.encodeStateAsUpdate(ydoc);

    mockSend.mockResolvedValueOnce({});

    await storage.storeDoc(documentName, state);

    expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    const call = mockSend.mock.calls[0][0];
    expect(call.input.Bucket).toBe('test-bucket');
    expect(call.input.Key).toBe(documentName);
    expect(call.input.Body).toEqual(Buffer.from(state));
  });

  it('should retrieve a document snapshot from S3', async () => {
    const documentName = 'snapshot-doc-2';
    const ydoc = new Y.Doc();
    ydoc.getText('content').insert(0, 'existing snapshot');
    const state = Y.encodeStateAsUpdate(ydoc);

    mockSend.mockResolvedValueOnce({
      Body: sdkStreamMixin(Readable.from(Buffer.from(state))),
    });

    const result = await storage.getDoc(documentName);

    expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    const call = mockSend.mock.calls[0][0];
    expect(call.input.Bucket).toBe('test-bucket');
    expect(call.input.Key).toBe(documentName);
    expect(result).toEqual(state);
  });

  it('should return null if the document does not exist in S3', async () => {
    const documentName = 'non-existent-doc';

    const noSuchKeyError = new Error('The specified key does not exist.');
    noSuchKeyError.name = 'NoSuchKey';
    mockSend.mockRejectedValueOnce(noSuchKeyError);

    const result = await storage.getDoc(documentName);

    expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    expect(result).toBeNull();
  });
});
