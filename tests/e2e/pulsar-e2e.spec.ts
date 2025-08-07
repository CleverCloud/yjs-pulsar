import { startServer } from '../../src/server';
import { ServerConfig, YjsPulsarServer } from '../../src/types';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { AddressInfo } from 'net';

// Single comprehensive E2E test for Pulsar integration
// All Pulsar tests run sequentially in one test to avoid client connection conflicts
describe('Pulsar E2E Integration', () => {
  let server: YjsPulsarServer;
  let config: ServerConfig;
  let port: number;
  const TEST_PORT = 34567;
  
  // Check if we have real Pulsar credentials
  const hasRealPulsar = process.env.ADDON_PULSAR_BINARY_URL && 
                        process.env.ADDON_PULSAR_TOKEN && 
                        process.env.ADDON_PULSAR_BINARY_URL !== 'pulsar://localhost:6650';
  
  beforeAll(async () => {
    if (!hasRealPulsar && !process.env.CI) {
      // Set mock values for local testing
      process.env.ADDON_PULSAR_BINARY_URL = 'pulsar://localhost:6650';
      process.env.ADDON_PULSAR_TOKEN = 'mock-token';
      process.env.ADDON_PULSAR_TENANT = 'public';
      process.env.ADDON_PULSAR_NAMESPACE = 'default';
    }

    // Use environment variables if available (for CI)
    config = {
      port: TEST_PORT,
      pulsarUrl: process.env.ADDON_PULSAR_BINARY_URL || 'pulsar://localhost:6650',
      pulsarToken: process.env.ADDON_PULSAR_TOKEN || '',
      pulsarTenant: process.env.ADDON_PULSAR_TENANT || 'public',
      pulsarNamespace: process.env.ADDON_PULSAR_NAMESPACE || 'default',
      pulsarTopicPrefix: process.env.PULSAR_TOPIC_PREFIX || 'e2e-test-',
    };

    if (!hasRealPulsar) {
      console.warn('No real Pulsar credentials detected, tests will use mock connections');
      // Use no storage when we don't have real Pulsar to avoid hanging
      process.env.STORAGE_TYPE = 'none';
    } else {
      // Set storage type to pulsar for snapshot tests
      process.env.STORAGE_TYPE = 'pulsar';
    }
    process.env.SNAPSHOT_INTERVAL = '5'; // Small interval for testing
    
    server = await startServer(config);
    const address = server.httpServer.address() as AddressInfo;
    port = address.port;
  }, 30000);

  afterAll(async () => {
    if (server) {
      try {
        await server.stop();
      } catch (error: any) {
        // Ignore AlreadyClosed errors during test cleanup
        if (!error.message?.includes('AlreadyClosed')) {
          console.error('Error stopping server in test cleanup:', error);
        }
      }
    }
    // Clean up env vars
    delete process.env.STORAGE_TYPE;
    delete process.env.SNAPSHOT_INTERVAL;
  }, 30000);

  it('should complete full Pulsar integration workflow', async () => {
    if (!hasRealPulsar) {
      console.warn('Skipping Pulsar integration test - requires real Pulsar connection');
      return;
    }
    
    const baseDocName = `integration-test-${Date.now()}`;
    
    console.log('=== Step 1: Basic WebSocket Connection ===');
    
    // Test 1: Basic connection
    const ws1 = new WebSocket(`ws://localhost:${port}/${baseDocName}-connection`);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      ws1.on('open', () => {
        clearTimeout(timeout);
        console.log('✓ WebSocket connection established');
        resolve();
      });

      ws1.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    
    expect(ws1.readyState).toBe(WebSocket.OPEN);
    ws1.close();
    await new Promise(resolve => ws1.on('close', resolve));
    
    console.log('=== Step 2: Sync Message Test ===');
    
    // Test 2: Sync message reception
    const ws2 = new WebSocket(`ws://localhost:${port}/${baseDocName}-sync`);
    await new Promise(resolve => ws2.on('open', resolve));
    
    const messages: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Message timeout'));
      }, 10000);

      ws2.on('message', (data: Buffer) => {
        console.log('✓ Received message:', data.length, 'bytes');
        messages.push(data);
        clearTimeout(timeout);
        resolve();
      });

      ws2.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    
    expect(messages.length).toBeGreaterThan(0);
    ws2.close();
    await new Promise(resolve => ws2.on('close', resolve));
    
    console.log('=== Step 3: Document Snapshot and Persistence ===');
    
    // Test 3: Snapshot storage with server restart
    const snapshotDocName = `${baseDocName}-snapshot`;
    const testText = 'This document will be snapshotted!';
    
    // Create document and add content
    const ws3 = new WebSocket(`ws://localhost:${port}/${snapshotDocName}`);
    await new Promise(resolve => ws3.on('open', resolve));

    const doc1 = new Y.Doc();
    const text1 = doc1.getText('test');
    
    // Wait for initial sync and add content
    await new Promise<void>((resolve) => {
      ws3.on('message', (data: any) => {
        const message = new Uint8Array(data);
        const decoder = decoding.createDecoder(message);
        const messageType = decoding.readVarUint(decoder);
        
        if (messageType === 0) { // Sync message
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 0);
          syncProtocol.readSyncMessage(decoder, encoder, doc1, ws3);
          
          if (encoding.length(encoder) > 1) {
            ws3.send(encoding.toUint8Array(encoder));
          }
          
          // Add our test content
          text1.insert(0, testText);
          
          // Send the update
          const updateEncoder = encoding.createEncoder();
          encoding.writeVarUint(updateEncoder, 0);
          syncProtocol.writeUpdate(updateEncoder, Y.encodeStateAsUpdate(doc1));
          ws3.send(encoding.toUint8Array(updateEncoder));
          
          setTimeout(resolve, 100);
        }
      });
    });

    // Add more changes to trigger snapshot (we set SNAPSHOT_INTERVAL=5)
    for (let i = 0; i < 8; i++) {
      text1.insert(text1.length, ` Edit ${i}`);
      
      const updateEncoder = encoding.createEncoder();
      encoding.writeVarUint(updateEncoder, 0);
      syncProtocol.writeUpdate(updateEncoder, Y.encodeStateAsUpdate(doc1));
      ws3.send(encoding.toUint8Array(updateEncoder));
      
      await new Promise(resolve => setTimeout(resolve, 100)); // Slower to ensure processing
    }

    console.log('✓ Document content added, triggering snapshots');
    ws3.close();
    await new Promise(resolve => ws3.on('close', resolve));

    // Wait for snapshot processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('=== Step 4: Server Restart and Content Verification ===');
    
    // Stop and restart server
    await server.stop();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    server = await startServer(config);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify content after restart
    const ws4 = new WebSocket(`ws://localhost:${port}/${snapshotDocName}`);
    await new Promise(resolve => ws4.on('open', resolve));

    const doc2 = new Y.Doc();
    const text2 = doc2.getText('test');
    
    await new Promise<void>((resolve) => {
      ws4.on('message', (data: any) => {
        const message = new Uint8Array(data);
        const decoder = decoding.createDecoder(message);
        const messageType = decoding.readVarUint(decoder);
        
        if (messageType === 0) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 0);
          syncProtocol.readSyncMessage(decoder, encoder, doc2, ws4);
          
          if (encoding.length(encoder) > 1) {
            ws4.send(encoding.toUint8Array(encoder));
          } else {
            // Sync complete
            resolve();
          }
        }
      });
    });

    // Verify the document was restored
    const restoredText = text2.toString();
    console.log('✓ Document restored after restart, content:', restoredText.substring(0, 50) + '...');
    expect(restoredText).toContain(testText);
    expect(restoredText).toContain('Edit 7'); // Last edit should be there
    
    console.log('=== Step 5: Incremental Updates After Restore ===');
    
    // Test 4: Add incremental updates after restore
    const postRestoreText = ' [Added after restore]';
    text2.insert(text2.length, postRestoreText);
    
    const incrementalEncoder = encoding.createEncoder();
    encoding.writeVarUint(incrementalEncoder, 0);
    syncProtocol.writeUpdate(incrementalEncoder, Y.encodeStateAsUpdate(doc2));
    ws4.send(encoding.toUint8Array(incrementalEncoder));

    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Connect new client to verify incremental update
    const ws5 = new WebSocket(`ws://localhost:${port}/${snapshotDocName}`);
    await new Promise(resolve => ws5.on('open', resolve));

    const doc3 = new Y.Doc();
    const text3 = doc3.getText('test');
    
    await new Promise<void>((resolve) => {
      ws5.on('message', (data: any) => {
        const message = new Uint8Array(data);
        const decoder = decoding.createDecoder(message);
        const messageType = decoding.readVarUint(decoder);
        
        if (messageType === 0) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 0);
          syncProtocol.readSyncMessage(decoder, encoder, doc3, ws5);
          
          if (encoding.length(encoder) > 1) {
            ws5.send(encoding.toUint8Array(encoder));
          } else {
            resolve();
          }
        }
      });
    });

    // Verify incremental update was preserved
    const finalText = text3.toString();
    console.log('✓ Final document content verified');
    expect(finalText).toContain(testText);
    expect(finalText).toContain('Edit 7');
    expect(finalText).toContain(postRestoreText);
    
    // Cleanup
    ws4.close();
    ws5.close();
    
    console.log('✅ All Pulsar integration tests completed successfully');
    
  }, 120000); // Long timeout for full integration test
});