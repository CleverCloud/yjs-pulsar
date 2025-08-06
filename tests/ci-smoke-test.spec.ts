/**
 * Smoke test for CI/CD - ensures basic functionality works
 * This test should ALWAYS pass in GitHub Actions
 */

import * as Y from 'yjs';
import { DocumentSnapshot } from '../src/storage/pulsar-storage';

describe('CI Smoke Tests', () => {
  it('should import all required modules without error', () => {
    expect(Y).toBeDefined();
    expect(Y.Doc).toBeDefined();
  });

  it('should create and serialize a DocumentSnapshot', () => {
    const snapshot: DocumentSnapshot = {
      state: [1, 2, 3, 4, 5],
      lastMessageId: 'test-message-id',
      messageCount: 10,
      timestamp: Date.now()
    };

    const serialized = JSON.stringify(snapshot);
    const parsed = JSON.parse(serialized);

    expect(parsed.state).toEqual([1, 2, 3, 4, 5]);
    expect(parsed.lastMessageId).toBe('test-message-id');
    expect(parsed.messageCount).toBe(10);
    expect(parsed.timestamp).toBeDefined();
  });

  it('should create a Yjs document and encode state', () => {
    const doc = new Y.Doc();
    const text = doc.getText('test');
    text.insert(0, 'Hello GitHub Actions!');

    const state = Y.encodeStateAsUpdate(doc);
    expect(state).toBeInstanceOf(Uint8Array);
    expect(state.length).toBeGreaterThan(0);

    // Verify we can convert to array for snapshot
    const stateArray = Array.from(state);
    expect(Array.isArray(stateArray)).toBe(true);
    expect(stateArray.length).toBe(state.length);
  });

  it('should handle snapshot state conversion', () => {
    // Create document
    const doc1 = new Y.Doc();
    const text1 = doc1.getText('test');
    text1.insert(0, 'Test content');

    // Create snapshot
    const state = Y.encodeStateAsUpdate(doc1);
    const snapshot: DocumentSnapshot = {
      state: Array.from(state),
      lastMessageId: 'msg-123',
      messageCount: 1,
      timestamp: Date.now()
    };

    // Restore from snapshot
    const doc2 = new Y.Doc();
    const restoredState = new Uint8Array(snapshot.state);
    Y.applyUpdate(doc2, restoredState);

    const text2 = doc2.getText('test').toString();
    expect(text2).toBe('Test content');
  });

  it('should validate GitHub Actions environment', () => {
    // Check if we're running in CI
    if (process.env.CI) {
      console.log('✅ Running in CI environment');
      expect(process.env.CI).toBe('true');
      
      // GitHub Actions specific
      if (process.env.GITHUB_ACTIONS) {
        console.log('✅ Running in GitHub Actions');
        expect(process.env.GITHUB_ACTIONS).toBe('true');
      }
    } else {
      console.log('ℹ️ Running locally');
      expect(process.env.CI).toBeUndefined();
    }
  });
});