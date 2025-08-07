import { startServer } from '../../src/server';
import { ServerConfig, YjsPulsarServer } from '../../src/types';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// Always run tests - mock values will be used if env vars are missing
describe('E2E: Snapshot Storage with Pulsar', () => {
  let server: YjsPulsarServer;
  let config: ServerConfig;
  const TEST_PORT = 34567;
  
  beforeAll(async () => {
    // Use environment variables if available (for CI)
    config = {
      port: TEST_PORT,
      pulsarUrl: process.env.ADDON_PULSAR_BINARY_URL || 'pulsar://localhost:6650',
      pulsarToken: process.env.ADDON_PULSAR_TOKEN || '',
      pulsarTenant: process.env.ADDON_PULSAR_TENANT || 'public',
      pulsarNamespace: process.env.ADDON_PULSAR_NAMESPACE || 'default',
      pulsarTopicPrefix: process.env.PULSAR_TOPIC_PREFIX || 'e2e-snapshot-test-',
    };

    // Set storage type to pulsar for these tests
    process.env.STORAGE_TYPE = 'pulsar';
    process.env.SNAPSHOT_INTERVAL = '10'; // Small interval for testing
    
    server = await startServer(config);
  }, 30000);

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
    // Clean up env vars
    delete process.env.STORAGE_TYPE;
    delete process.env.SNAPSHOT_INTERVAL;
  });

  it('should persist document across server restarts with snapshots', async () => {
    const docName = `snapshot-test-${Date.now()}`;
    const testText = 'This document will be snapshotted!';
    
    // Step 1: Create document and add content
    const ws1 = new WebSocket(`ws://localhost:${TEST_PORT}/${docName}`);
    await new Promise(resolve => ws1.on('open', resolve));

    const doc1 = new Y.Doc();
    const text1 = doc1.getText('test');
    
    // Wait for initial sync
    await new Promise<void>(resolve => {
      ws1.on('message', (data: any) => {
        const message = new Uint8Array(data);
        const decoder = decoding.createDecoder(message);
        const messageType = decoding.readVarUint(decoder);
        
        if (messageType === 0) { // Sync message
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 0); // messageSync
          syncProtocol.readSyncMessage(decoder, encoder, doc1, ws1);
          
          if (encoding.length(encoder) > 1) {
            ws1.send(encoding.toUint8Array(encoder));
          }
          
          // Add our test content
          text1.insert(0, testText);
          
          // Send the update
          const updateEncoder = encoding.createEncoder();
          encoding.writeVarUint(updateEncoder, 0); // messageSync
          syncProtocol.writeUpdate(updateEncoder, Y.encodeStateAsUpdate(doc1));
          ws1.send(encoding.toUint8Array(updateEncoder));
          
          setTimeout(resolve, 100); // Give time for server to process
        }
      });
    });

    // Add more changes to trigger snapshot (we set SNAPSHOT_INTERVAL=10)
    for (let i = 0; i < 15; i++) {
      text1.insert(text1.length, ` Edit ${i}`);
      
      const updateEncoder = encoding.createEncoder();
      encoding.writeVarUint(updateEncoder, 0);
      syncProtocol.writeUpdate(updateEncoder, Y.encodeStateAsUpdate(doc1));
      ws1.send(encoding.toUint8Array(updateEncoder));
      
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    ws1.close();
    await new Promise(resolve => ws1.on('close', resolve));

    // Step 2: Stop and restart server
    await server.stop();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    server = await startServer(config);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 3: Connect new client and verify content
    const ws2 = new WebSocket(`ws://localhost:${TEST_PORT}/${docName}`);
    await new Promise(resolve => ws2.on('open', resolve));

    const doc2 = new Y.Doc();
    const text2 = doc2.getText('test');
    
    await new Promise<void>(resolve => {
      ws2.on('message', (data: any) => {
        const message = new Uint8Array(data);
        const decoder = decoding.createDecoder(message);
        const messageType = decoding.readVarUint(decoder);
        
        if (messageType === 0) { // Sync message
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 0);
          syncProtocol.readSyncMessage(decoder, encoder, doc2, ws2);
          
          if (encoding.length(encoder) > 1) {
            ws2.send(encoding.toUint8Array(encoder));
          } else {
            // Sync complete - check content
            resolve();
          }
        }
      });
    });

    // Verify the document was restored
    const restoredText = text2.toString();
    expect(restoredText).toContain(testText);
    expect(restoredText).toContain('Edit 14'); // Last edit should be there
    
    ws2.close();
  }, 60000);

  it('should handle incremental updates after snapshot restore', async () => {
    const docName = `incremental-${Date.now()}`;
    
    // Create initial document
    const ws1 = new WebSocket(`ws://localhost:${TEST_PORT}/${docName}`);
    await new Promise(resolve => ws1.on('open', resolve));

    const doc1 = new Y.Doc();
    const text1 = doc1.getText('test');
    
    // Initial sync and content
    await new Promise<void>(resolve => {
      ws1.on('message', (data: any) => {
        const message = new Uint8Array(data);
        const decoder = decoding.createDecoder(message);
        const messageType = decoding.readVarUint(decoder);
        
        if (messageType === 0) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 0);
          syncProtocol.readSyncMessage(decoder, encoder, doc1, ws1);
          
          if (encoding.length(encoder) > 1) {
            ws1.send(encoding.toUint8Array(encoder));
          }
          
          text1.insert(0, 'Initial content');
          const updateEncoder = encoding.createEncoder();
          encoding.writeVarUint(updateEncoder, 0);
          syncProtocol.writeUpdate(updateEncoder, Y.encodeStateAsUpdate(doc1));
          ws1.send(encoding.toUint8Array(updateEncoder));
          
          setTimeout(resolve, 100);
        }
      });
    });

    // Add exactly SNAPSHOT_INTERVAL changes to trigger snapshot
    for (let i = 0; i < 10; i++) {
      text1.insert(text1.length, ` ${i}`);
      const updateEncoder = encoding.createEncoder();
      encoding.writeVarUint(updateEncoder, 0);
      syncProtocol.writeUpdate(updateEncoder, Y.encodeStateAsUpdate(doc1));
      ws1.send(encoding.toUint8Array(updateEncoder));
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Add a few more changes AFTER snapshot
    const postSnapshotText = ' [Added after snapshot]';
    text1.insert(text1.length, postSnapshotText);
    const updateEncoder = encoding.createEncoder();
    encoding.writeVarUint(updateEncoder, 0);
    syncProtocol.writeUpdate(updateEncoder, Y.encodeStateAsUpdate(doc1));
    ws1.send(encoding.toUint8Array(updateEncoder));

    await new Promise(resolve => setTimeout(resolve, 500));
    ws1.close();

    // Connect new client - should get snapshot + incremental updates
    const ws2 = new WebSocket(`ws://localhost:${TEST_PORT}/${docName}`);
    await new Promise(resolve => ws2.on('open', resolve));

    const doc2 = new Y.Doc();
    const text2 = doc2.getText('test');
    
    await new Promise<void>(resolve => {
      ws2.on('message', (data: any) => {
        const message = new Uint8Array(data);
        const decoder = decoding.createDecoder(message);
        const messageType = decoding.readVarUint(decoder);
        
        if (messageType === 0) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 0);
          syncProtocol.readSyncMessage(decoder, encoder, doc2, ws2);
          
          if (encoding.length(encoder) > 1) {
            ws2.send(encoding.toUint8Array(encoder));
          } else {
            resolve();
          }
        }
      });
    });

    // Should have both snapshot content AND incremental updates
    const finalText = text2.toString();
    expect(finalText).toContain('Initial content');
    expect(finalText).toContain(' 9'); // Last pre-snapshot update
    expect(finalText).toContain(postSnapshotText); // Post-snapshot update
    
    ws2.close();
  }, 30000);
});