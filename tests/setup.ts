// Set up environment variables for unit tests
// Use 'none' storage for most unit tests to avoid S3 dependencies
if (!process.env.STORAGE_TYPE) {
  process.env.STORAGE_TYPE = 'none';
}

// Only set S3 credentials if we're explicitly testing S3 storage
process.env.S3_BUCKET = 'test-bucket';
process.env.S3_ENDPOINT = 'http://localhost:9000';
process.env.S3_ACCESS_KEY_ID = 'test-access-key';
process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';
