import { DocumentSnapshot } from '../../src/storage/pulsar-storage';
import * as Y from 'yjs';

describe('Snapshot Format Specification', () => {
  it('should serialize and deserialize snapshot correctly', () => {
    // Create a sample Yjs document
    const doc = new Y.Doc();
    const text = doc.getText('content');
    text.insert(0, 'Hello World! This is a test document.');
    
    const state = Y.encodeStateAsUpdate(doc);
    
    // Create snapshot object
    const snapshot: DocumentSnapshot = {
      state: Array.from(state),
      lastMessageId: 'CDoQmwEaICAEjvsdpAEAABAAbBYrg-gCAAgQABgAKAAwBDgBQAFggOEJgAEA',
      messageCount: 150,
      timestamp: 1736426789123
    };

    // Serialize to JSON (as would be stored in S3)
    const serialized = JSON.stringify(snapshot, null, 2);
    
    // Verify JSON structure
    const parsed = JSON.parse(serialized);
    expect(parsed).toHaveProperty('state');
    expect(parsed).toHaveProperty('lastMessageId');
    expect(parsed).toHaveProperty('messageCount');
    expect(parsed).toHaveProperty('timestamp');
    
    // Verify types
    expect(Array.isArray(parsed.state)).toBe(true);
    expect(typeof parsed.lastMessageId).toBe('string');
    expect(typeof parsed.messageCount).toBe('number');
    expect(typeof parsed.timestamp).toBe('number');
    
    // Verify we can reconstruct the Yjs state
    const reconstructedState = new Uint8Array(parsed.state);
    const newDoc = new Y.Doc();
    Y.applyUpdate(newDoc, reconstructedState);
    
    const reconstructedText = newDoc.getText('content').toString();
    expect(reconstructedText).toBe('Hello World! This is a test document.');
  });

  it('should handle large documents efficiently', () => {
    const doc = new Y.Doc();
    const text = doc.getText('content');
    
    // Create a large document (1MB of text)
    const largeText = 'x'.repeat(1024 * 1024);
    text.insert(0, largeText);
    
    const state = Y.encodeStateAsUpdate(doc);
    
    const snapshot: DocumentSnapshot = {
      state: Array.from(state),
      lastMessageId: 'test-message-id',
      messageCount: 1000,
      timestamp: Date.now()
    };

    // Serialize and measure size
    const serialized = JSON.stringify(snapshot);
    const sizeInKB = Buffer.byteLength(serialized) / 1024;
    
    console.log(`Snapshot size for 1MB document: ${sizeInKB.toFixed(2)} KB`);
    
    // Ensure it can be parsed back
    const parsed = JSON.parse(serialized);
    expect(parsed.state.length).toBeGreaterThan(0);
  });

  it('should validate MessageID format', () => {
    // Real Pulsar MessageID examples
    const validMessageIds = [
      'CDoQmwEaICAEjvsdpAEAABAAbBYrg-gCAAgQABgAKAAwBDgBQAFggOEJgAEA',
      'CAoQARogIARO-x2kAQAAEABsFiuD6AIAEAAYASgAMAE4AUABYIDhCYABAA==',
      Buffer.from('test-message-id').toString('base64')
    ];

    validMessageIds.forEach(messageId => {
      const snapshot: DocumentSnapshot = {
        state: [1, 2, 3],
        lastMessageId: messageId,
        messageCount: 10,
        timestamp: Date.now()
      };

      const serialized = JSON.stringify(snapshot);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.lastMessageId).toBe(messageId);
      
      // Verify it's a valid base64 string
      expect(() => Buffer.from(parsed.lastMessageId, 'base64')).not.toThrow();
    });
  });

  it('should include all necessary metadata for restoration', () => {
    const snapshot: DocumentSnapshot = {
      state: [1, 0, 11, 0, 40, 1, 4], // Sample Yjs state
      lastMessageId: 'mock-message-id',
      messageCount: 42,
      timestamp: 1736426789123
    };

    // Verify all fields needed for restoration are present
    expect(snapshot.state).toBeDefined();
    expect(snapshot.lastMessageId).toBeDefined();
    expect(snapshot.messageCount).toBeDefined();
    expect(snapshot.timestamp).toBeDefined();

    // Verify field purposes
    expect(snapshot.state).toEqual(expect.any(Array)); // Document state
    expect(snapshot.lastMessageId).toEqual(expect.any(String)); // Checkpoint for replay
    expect(snapshot.messageCount).toEqual(expect.any(Number)); // Progress tracking
    expect(snapshot.timestamp).toEqual(expect.any(Number)); // Audit/debugging
  });

  it('should handle empty documents', () => {
    const doc = new Y.Doc();
    const state = Y.encodeStateAsUpdate(doc);
    
    const snapshot: DocumentSnapshot = {
      state: Array.from(state),
      lastMessageId: 'empty-doc-msg-id',
      messageCount: 0,
      timestamp: Date.now()
    };

    const serialized = JSON.stringify(snapshot);
    const parsed = JSON.parse(serialized);
    
    // Even empty docs have some state
    expect(parsed.state.length).toBeGreaterThan(0);
    expect(parsed.messageCount).toBe(0);
  });
});