import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
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
  const mockedS3Client = S3Client as jest.Mock;

  beforeEach(() => {
    // Set up environment variables for S3
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_ENDPOINT = 'http://localhost:9000';
    process.env.S3_ACCESS_KEY_ID = 'test-access-key';
    process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';

    // Clear all mocks before each test
    mockedS3Client.mockClear();
    mockSend.mockClear();

    storage = new S3Storage();
  });

  it('should store an update in S3', async () => {
    const documentName = 's3-doc';
    const ydoc = new Y.Doc();
    ydoc.getText('text').insert(0, 's3 test');
    const update = Y.encodeStateAsUpdate(ydoc);

    mockSend.mockResolvedValueOnce({});

    await storage.storeUpdate(documentName, update);

    expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    const call = mockSend.mock.calls[0][0];
    expect(call.input.Bucket).toBe('test-bucket');
    expect(call.input.Key).toMatch(new RegExp(`^${documentName}/`));
    expect(call.input.Body).toEqual(Buffer.from(update));
  });

  it('should fetch a document from S3 by merging updates', async () => {
    const documentName = 's3-doc-2';
    const ydoc1 = new Y.Doc();
    ydoc1.getText('content').insert(0, 's3 hello');
    const update1 = Y.encodeStateAsUpdate(ydoc1);

    const ydoc2 = new Y.Doc();
    Y.applyUpdate(ydoc2, update1);
    ydoc2.getText('content').insert(8, ' world');
    const update2 = Y.encodeStateAsUpdate(ydoc2, Y.encodeStateVector(ydoc1));

    // Mock S3 responses based on the command type
    mockSend.mockImplementation(async (command) => {
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: [{ Key: `${documentName}/1` }, { Key: `${documentName}/2` }],
        };
      }
      if (command instanceof GetObjectCommand) {
        if (command.input.Key === `${documentName}/1`) {
          return { Body: sdkStreamMixin(Readable.from(Buffer.from(update1))) };
        }
        if (command.input.Key === `${documentName}/2`) {
          return { Body: sdkStreamMixin(Readable.from(Buffer.from(update2))) };
        }
      }
      throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
    });

    const finalUpdate = await storage.fetchDocument(documentName);
    const finalDoc = new Y.Doc();
    Y.applyUpdate(finalDoc, finalUpdate);

    expect(finalDoc.getText('content').toString()).toBe('s3 hello world');
    expect(mockSend).toHaveBeenCalledWith(expect.any(ListObjectsV2Command));
    expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
  });

  it('should return an empty document if no updates exist in S3', async () => {
    const documentName = 'non-existent-s3-doc';
    mockSend.mockResolvedValueOnce({ Contents: [] });

    const finalUpdate = await storage.fetchDocument(documentName);
    const finalDoc = new Y.Doc();
    Y.applyUpdate(finalDoc, finalUpdate);

    expect(finalDoc.share.size).toBe(0);
  });
});
