#!/usr/bin/env node

const { S3Client, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function clearSnapshots() {
  console.log('🧹 Clearing corrupted S3 snapshots...');
  
  // Initialize S3 client with the same configuration as the app
  const s3Client = new S3Client({
    region: 'auto',
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  
  const bucketName = process.env.S3_BUCKET;
  console.log(`📦 Using bucket: ${bucketName}`);
  
  try {
    // List all snapshot files
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: 'snapshots/',
    });
    
    const response = await s3Client.send(listCommand);
    
    if (!response.Contents || response.Contents.length === 0) {
      console.log('✅ No snapshots found to clear');
      return;
    }
    
    console.log(`Found ${response.Contents.length} snapshot files:`);
    response.Contents.forEach(obj => console.log(`  - ${obj.Key}`));
    
    // Delete all snapshot files
    for (const object of response.Contents) {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: object.Key,
      });
      
      await s3Client.send(deleteCommand);
      console.log(`🗑️  Deleted: ${object.Key}`);
    }
    
    console.log('✅ All corrupted snapshots cleared successfully!');
    console.log('🔄 Application will now start fresh without corrupted snapshots');
    
  } catch (error) {
    console.error('❌ Failed to clear snapshots:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  clearSnapshots().catch(console.error);
}

module.exports = { clearSnapshots };