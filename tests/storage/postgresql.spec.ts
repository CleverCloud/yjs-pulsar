import { Pool } from 'pg';
import { PostgreSQLStorage } from '../../src/storage/postgresql';
import * as Y from 'yjs';

// Mock the 'pg' module
jest.mock('pg', () => {
  const mClient = {
    connect: jest.fn(),
    query: jest.fn(),
    release: jest.fn(),
  };
  const mPool = {
    connect: jest.fn(() => Promise.resolve(mClient)),
  };
  return { Pool: jest.fn(() => mPool) };
});

describe('PostgreSQLStorage', () => {
  let storage: PostgreSQLStorage;
  let pool: Pool;

  beforeEach(() => {
    // Clear all instances and calls to constructor and all methods: 
    (Pool as unknown as jest.Mock).mockClear();
    storage = new PostgreSQLStorage();
    // Get the mock pool instance
    pool = (Pool as unknown as jest.Mock).mock.results[0].value;
  });

  it('should store an update', async () => {
    const documentName = 'test-doc';
    const ydoc = new Y.Doc();
    const text = ydoc.getText('test');
    text.insert(0, 'hello');
    const update = Y.encodeStateAsUpdate(ydoc);

    const client = await pool.connect();
    (client.query as jest.Mock).mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await storage.storeUpdate(documentName, update);

    expect(client.query).toHaveBeenCalledWith(
      'INSERT INTO yjs_updates (document_name, update) VALUES ($1, $2)',
      [documentName, Buffer.from(update)]
    );
  });

  it('should fetch a document by merging updates', async () => {
    const documentName = 'test-doc-2';
    const ydoc1 = new Y.Doc();
    ydoc1.getText('content').insert(0, 'hello');
    const update1 = Y.encodeStateAsUpdate(ydoc1);

    const ydoc2 = new Y.Doc();
    Y.applyUpdate(ydoc2, update1);
    ydoc2.getText('content').insert(5, ' world');
    const update2 = Y.encodeStateAsUpdate(ydoc2, Y.encodeStateVector(ydoc1));

    const client = await pool.connect();
    (client.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ update: Buffer.from(update1) }, { update: Buffer.from(update2) }],
    });

    const finalUpdate = await storage.fetchDocument(documentName);
    const finalDoc = new Y.Doc();
    Y.applyUpdate(finalDoc, finalUpdate);

    expect(finalDoc.getText('content').toString()).toBe('hello world');
    expect(client.query).toHaveBeenCalledWith(
      'SELECT update FROM yjs_updates WHERE document_name = $1 ORDER BY created_at ASC',
      [documentName]
    );
  });

    it('should return an empty document if no updates exist', async () => {
    const documentName = 'non-existent-doc';
    const client = await pool.connect();
    (client.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const finalUpdate = await storage.fetchDocument(documentName);

    // The update for an empty doc is not empty, it contains structure.
    expect(finalUpdate.length).toBeGreaterThan(0);

    const finalDoc = new Y.Doc();
    Y.applyUpdate(finalDoc, finalUpdate);

    // An empty doc will have a share size of 0
    expect(finalDoc.share.size).toBe(0);
  });
});
