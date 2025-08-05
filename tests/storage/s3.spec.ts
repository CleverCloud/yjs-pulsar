import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { S3Storage } from '../../src/storage/s3';
import * as Y from 'yjs';
import { Readable } from 'stream';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const originalModule = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...originalModule,
    S3Client: jest.fn(() => ({ send: mockSend })),
  };
});

describe('S3Storage', () => {
  let storage: S3Storage;
  const bucket = 'test-bucket';

  beforeEach(() => {
    process.env.S3_BUCKET = bucket;
    process.env.S3_ENDPOINT = 'http://localhost:9000';
    process.env.S3_ACCESS_KEY_ID = 'test-access-key';
    process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';

    mockSend.mockClear();
    (S3Client as jest.Mock).mockClear();

    storage = new S3Storage();
  });

  it('should store a document snapshot in S3', async () => {
    const docName = 'snapshot-doc';
    const ydoc = new Y.Doc();
    ydoc.getText('content').insert(0, 'snapshot content');
    const state = Y.encodeStateAsUpdate(ydoc);

    mockSend.mockResolvedValueOnce({});

    await storage.storeDoc(docName, state);

    expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    const { input } = mockSend.mock.calls[0][0];
    expect(input.Bucket).toBe(bucket);
    expect(input.Key).toBe(docName);
    expect(input.Body).toEqual(Buffer.from(state));
  });

  it('should retrieve a document snapshot from S3', async () => {
    const docName = 'snapshot-doc-2';
    const ydoc = new Y.Doc();
    ydoc.getText('content').insert(0, 'existing snapshot');
    const state = Y.encodeStateAsUpdate(ydoc);

    mockSend.mockResolvedValueOnce({ Body: Readable.from(Buffer.from(state)) });

    const result = await storage.getDoc(docName);

    expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    const { input } = mockSend.mock.calls[0][0];
    expect(input.Bucket).toBe(bucket);
    expect(input.Key).toBe(docName);
    expect(result).toEqual(state);
  });

  it('should return null if the document does not exist in S3', async () => {
    const docName = 'non-existent-doc';

    const noSuchKeyError = { name: 'NoSuchKey' };
    mockSend.mockRejectedValueOnce(noSuchKeyError);

    const result = await storage.getDoc(docName);

    expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    expect(result).toBeNull();
  });
});