import { S3Storage } from '../../src/storage/s3';
import * as Y from 'yjs';

// Skip if not in CI with MinIO
const skipIfNoMinIO = !process.env.CI || !process.env.S3_ENDPOINT?.includes('localhost:9000');

const describeOrSkip = skipIfNoMinIO ? describe.skip : describe;

describeOrSkip('S3Storage with MinIO', () => {
  let storage: S3Storage;
  
  beforeAll(() => {
    // Use MinIO credentials from CI
    process.env.S3_ACCESS_KEY_ID = 'minioadmin';
    process.env.S3_SECRET_ACCESS_KEY = 'minioadmin';
    process.env.S3_ENDPOINT = 'http://localhost:9000';
    process.env.S3_BUCKET = 'test-bucket';
    
    storage = new S3Storage();
  });

  it('should store and retrieve document from MinIO', async () => {
    const docName = `minio-test-${Date.now()}`;
    
    // Create a test document
    const doc = new Y.Doc();
    const text = doc.getText('content');
    text.insert(0, 'Hello MinIO from GitHub Actions!');
    
    const state = Y.encodeStateAsUpdate(doc);
    
    // Store in MinIO
    await storage.storeDoc(docName, state);
    
    // Retrieve from MinIO
    const retrieved = await storage.getDoc(docName);
    
    expect(retrieved).not.toBeNull();
    expect(retrieved).toEqual(state);
    
    // Verify content
    const newDoc = new Y.Doc();
    Y.applyUpdate(newDoc, retrieved!);
    const retrievedText = newDoc.getText('content').toString();
    
    expect(retrievedText).toBe('Hello MinIO from GitHub Actions!');
  });

  it('should handle snapshot storage format in MinIO', async () => {
    const snapshotKey = `snapshots/test-doc-${Date.now()}.snapshot.json`;
    
    const snapshot = {
      state: [1, 2, 3, 4, 5],
      lastMessageId: 'test-message-id',
      messageCount: 42,
      timestamp: Date.now()
    };
    
    // Store snapshot
    await storage.storeDoc(snapshotKey, Buffer.from(JSON.stringify(snapshot)));
    
    // Retrieve snapshot
    const retrieved = await storage.getDoc(snapshotKey);
    expect(retrieved).not.toBeNull();
    
    const parsedSnapshot = JSON.parse(retrieved!.toString());
    expect(parsedSnapshot.state).toEqual([1, 2, 3, 4, 5]);
    expect(parsedSnapshot.messageCount).toBe(42);
  });

  it('should return null for non-existent documents', async () => {
    const result = await storage.getDoc('non-existent-doc');
    expect(result).toBeNull();
  });

  it('should handle large documents', async () => {
    const docName = `large-doc-${Date.now()}`;
    
    // Create a large document (100KB)
    const doc = new Y.Doc();
    const text = doc.getText('content');
    const largeText = 'x'.repeat(100 * 1024);
    text.insert(0, largeText);
    
    const state = Y.encodeStateAsUpdate(doc);
    
    // Store and retrieve
    await storage.storeDoc(docName, state);
    const retrieved = await storage.getDoc(docName);
    
    expect(retrieved).not.toBeNull();
    expect(retrieved!.length).toBe(state.length);
  });
});