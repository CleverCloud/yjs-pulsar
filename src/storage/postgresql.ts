import { Pool } from 'pg';
import * as Y from 'yjs';
import { Storage } from './storage';

export class PostgreSQLStorage implements Storage {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    this.initSchema();
  }

  private async initSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS yjs_updates (
          id SERIAL PRIMARY KEY,
          document_name VARCHAR(255) NOT NULL,
          update BYTEA NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } finally {
      client.release();
    }
  }

  async storeUpdate(documentName: string, update: Uint8Array): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        'INSERT INTO yjs_updates (document_name, update) VALUES ($1, $2)',
        [documentName, Buffer.from(update)]
      );
    } finally {
      client.release();
    }
  }

  async fetchDocument(documentName: string): Promise<Uint8Array> {
    const client = await this.pool.connect();
    try {
      const res = await client.query(
        'SELECT update FROM yjs_updates WHERE document_name = $1 ORDER BY created_at ASC',
        [documentName]
      );

      if (res.rows.length === 0) {
        // Return an empty Yjs document if no updates are found
        const ydoc = new Y.Doc();
        return Y.encodeStateAsUpdate(ydoc);
      }

      const updates = res.rows.map(row => new Uint8Array(row.update));
      const mergedDoc = Y.mergeUpdates(updates);
      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, mergedDoc);

      return Y.encodeStateAsUpdate(ydoc);
    } finally {
      client.release();
    }
  }
}
