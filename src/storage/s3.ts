import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Storage } from './storage';
import { Readable } from 'stream';

export class S3Storage implements Storage {
  private s3: S3Client;
  private bucket: string;

  constructor() {
    if (!process.env.S3_BUCKET || !process.env.S3_ENDPOINT) {
      throw new Error('S3_BUCKET and S3_ENDPOINT must be defined in environment variables');
    }
    
    // Validate credentials are provided
    if (!process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
      throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be defined in environment variables');
    }
    
    this.s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: true,
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
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

  async storeDoc(documentName: string, state: Uint8Array): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: documentName,
      Body: Buffer.from(state),
    });
    await this.s3.send(command);
  }

  async getDoc(documentName: string): Promise<Uint8Array | null> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: documentName,
    });

    try {
      const response = await this.s3.send(command);
      if (response.Body) {
        return await this.streamToUint8Array(response.Body as Readable);
      }
      return null;
    } catch (error: any) {
      // Handle common S3 errors gracefully
      if (error.name === 'NoSuchKey' || 
          error.Code === 'NoSuchKey' ||
          error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      
      // Handle invalid credentials or access errors
      if (error.Code === 'InvalidAccessKeyId' ||
          error.Code === 'SignatureDoesNotMatch' ||
          error.Code === 'AccessDenied' ||
          error.$metadata?.httpStatusCode === 403) {
        console.error(`[S3Storage] Access denied to S3: ${error.Code || error.message}`);
        return null;
      }
      
      // For any other error, log and re-throw
      console.error(`[S3Storage] Unexpected S3 error:`, error);
      throw error;
    }
  }
}
