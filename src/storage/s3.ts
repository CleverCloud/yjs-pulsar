import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import * as Y from 'yjs';
import { Storage } from './storage';
import { Readable } from 'stream';

export class S3Storage implements Storage {
  private s3: S3Client;
  private bucket: string;

  constructor() {
    if (!process.env.S3_BUCKET || !process.env.S3_ENDPOINT) {
      throw new Error('S3_BUCKET and S3_ENDPOINT must be defined in environment variables');
    }
    this.s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: 'auto', // Region is often 'auto' for non-AWS S3-compatible services
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
    });
    this.bucket = process.env.S3_BUCKET;
  }

  private async streamToUint8Array(stream: Readable): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  async storeUpdate(documentName: string, update: Uint8Array): Promise<void> {
    const key = `${documentName}/${Date.now()}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: Buffer.from(update),
    });
    await this.s3.send(command);
  }

  async fetchDocument(documentName: string): Promise<Uint8Array> {
    const listCommand = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: `${documentName}/`,
    });

    const listedObjects = await this.s3.send(listCommand);

    if (!listedObjects.Contents || listedObjects.Contents.length === 0) {
      const ydoc = new Y.Doc();
      return Y.encodeStateAsUpdate(ydoc);
    }

    const updates: Uint8Array[] = [];
    for (const object of listedObjects.Contents) {
      if (object.Key) {
        const getCommand = new GetObjectCommand({
          Bucket: this.bucket,
          Key: object.Key,
        });
        const response = await this.s3.send(getCommand);
        if (response.Body) {
          updates.push(await this.streamToUint8Array(response.Body as Readable));
        }
      }
    }

    if (updates.length === 0) {
        const ydoc = new Y.Doc();
        return Y.encodeStateAsUpdate(ydoc);
    }

    const mergedDoc = Y.mergeUpdates(updates);
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, mergedDoc);

    return Y.encodeStateAsUpdate(ydoc);
  }
}
