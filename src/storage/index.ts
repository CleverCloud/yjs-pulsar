import { Storage } from './storage';
import { PostgreSQLStorage } from './postgresql';
import { S3Storage } from './s3';

let storage: Storage | undefined;

export function getStorage(): Storage {
  if (storage) {
    return storage;
  }

  const storageProvider = process.env.STORAGE_PROVIDER || 'postgresql';

  if (storageProvider === 's3') {
    storage = new S3Storage();
  } else {
    storage = new PostgreSQLStorage();
  }

  return storage;
}
