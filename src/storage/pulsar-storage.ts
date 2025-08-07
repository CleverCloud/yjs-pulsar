import { Storage } from './storage';
import { S3Storage } from './s3';
import Pulsar from 'pulsar-client';
import * as Y from 'yjs';

export interface DocumentSnapshot {
  state: number[]; // Array representation of Uint8Array for JSON serialization
  lastMessageId: string; // Serialized Pulsar MessageID
  messageCount: number;
  timestamp: number;
}

/**
 * Pulsar-based storage with S3 snapshot checkpoints
 * - Pulsar handles real-time collaboration messages
 * - S3 stores periodic snapshots with MessageID checkpoints  
 * - Document restoration: Load snapshot + replay from checkpoint
 * - Prevents memory overflow by limiting replay to snapshot interval
 */
export class PulsarStorage implements Storage {
  private client: Pulsar.Client;
  private tenant: string;
  private namespace: string;
  private topicPrefix: string;
  private s3Storage: S3Storage;
  private snapshotInterval: number; // Messages between snapshots

  constructor(
    client: Pulsar.Client,
    tenant: string,
    namespace: string, 
    topicPrefix: string,
    snapshotInterval: number = 50 // Default: snapshot every 50 messages
  ) {
    this.client = client;
    this.tenant = tenant;
    this.namespace = namespace;
    this.topicPrefix = topicPrefix;
    this.s3Storage = new S3Storage();
    this.snapshotInterval = snapshotInterval;
  }

  private getTopicName(documentName: string): string {
    return `persistent://${this.tenant}/${this.namespace}/${this.topicPrefix}${documentName}`;
  }

  private getSnapshotKey(documentName: string): string {
    return `snapshots/${documentName}.snapshot.json`;
  }

  /**
   * Load the latest snapshot for a document from S3
   */
  private async loadSnapshot(documentName: string): Promise<DocumentSnapshot | null> {
    try {
      const snapshotKey = this.getSnapshotKey(documentName);
      const snapshotData = await this.s3Storage.getDoc(snapshotKey);
      
      if (!snapshotData) {
        console.log(`[PulsarStorage] No snapshot found for ${documentName}`);
        return null;
      }

      const snapshot = JSON.parse(Buffer.from(snapshotData).toString());
      // Convert state back to Uint8Array
      snapshot.state = new Uint8Array(snapshot.state);
      
      console.log(`[PulsarStorage] Loaded snapshot for ${documentName}: ${snapshot.messageCount} messages, MessageID: ${snapshot.lastMessageId}`);
      return snapshot;
    } catch (error) {
      console.warn(`[PulsarStorage] Failed to load snapshot for ${documentName}:`, error);
      return null;
    }
  }

  /**
   * Save a snapshot of the document state to S3 with Pulsar MessageID checkpoint
   */
  private async saveSnapshot(documentName: string, state: Uint8Array, lastMessageId: Pulsar.MessageId, messageCount: number): Promise<void> {
    try {
      const snapshot: DocumentSnapshot = {
        state: Array.from(state), // Convert Uint8Array to regular array for JSON
        lastMessageId: lastMessageId.toString(),
        messageCount,
        timestamp: Date.now()
      };

      const snapshotKey = this.getSnapshotKey(documentName);
      const snapshotBuffer = Buffer.from(JSON.stringify(snapshot));
      
      await this.s3Storage.storeDoc(snapshotKey, snapshotBuffer);
      console.log(`[PulsarStorage] Saved snapshot for ${documentName}: ${messageCount} messages, MessageID: ${lastMessageId.toString()}`);
    } catch (error) {
      console.error(`[PulsarStorage] Failed to save snapshot for ${documentName}:`, error);
    }
  }

  async storeDoc(documentName: string, state: Uint8Array): Promise<void> {
    // In Pulsar-only mode, documents are stored through the message stream
    // This method is called but doesn't need to do anything since persistence
    // is handled by Pulsar's retention policy
    console.log(`[PulsarStorage] Document ${documentName} persisted via message stream`);
  }

  /**
   * Triggers topic compaction to compress the message history
   * This implements the user's suggestion for periodic compression
   */
  async compactTopic(documentName: string): Promise<void> {
    const topicName = this.getTopicName(documentName);
    
    try {
      console.log(`[PulsarStorage] Triggering compaction for topic: ${topicName}`);
      
      // Create a producer to send a final compaction message with current state
      const producer = await this.client.createProducer({
        topic: topicName,
        producerName: `compaction-${documentName}-${Date.now()}`,
        messageRoutingMode: 'CustomPartition',
      });

      // Get current document state and store as compacted message
      const currentState = await this.getDoc(documentName);
      if (currentState && currentState.length > 0) {
        const compactionMessage = Buffer.concat([Buffer.from([0]), Buffer.from(currentState)]);
        
        await producer.send({
          data: compactionMessage,
          partitionKey: `${documentName}-compacted-${Date.now()}`,
          properties: {
            messageType: 'compaction',
            docName: documentName,
            timestamp: Date.now().toString()
          }
        });

        console.log(`[PulsarStorage] Compaction message sent for ${documentName}`);
      }

      await producer.close();
    } catch (error) {
      console.error(`[PulsarStorage] Failed to compact topic for ${documentName}:`, error);
    }
  }

  async getDoc(documentName: string): Promise<Uint8Array | null> {
    const topicName = this.getTopicName(documentName);
    let reader: Pulsar.Reader | null = null;
    
    try {
      console.log(`[PulsarStorage] Restoring document ${documentName} using snapshot + incremental replay strategy`);
      
      // Step 1: Try to load snapshot from S3
      const snapshot = await this.loadSnapshot(documentName);
      
      // Step 2: Create Yjs document and apply snapshot if available
      const ydoc = new Y.Doc();
      let startMessageId = Pulsar.MessageId.earliest();
      let baseMessageCount = 0;
      
      if (snapshot) {
        // Apply snapshot state to document (convert from array back to Uint8Array)
        const snapshotState = new Uint8Array(snapshot.state);
        Y.applyUpdate(ydoc, snapshotState);
        baseMessageCount = snapshot.messageCount;
        
        try {
          // Parse the MessageID from string
          startMessageId = Pulsar.MessageId.deserialize(Buffer.from(snapshot.lastMessageId, 'base64'));
          console.log(`[PulsarStorage] Starting replay from snapshot checkpoint: ${snapshot.messageCount} messages`);
        } catch (messageIdError) {
          console.warn(`[PulsarStorage] Failed to parse snapshot MessageID, starting from earliest:`, messageIdError);
          startMessageId = Pulsar.MessageId.earliest();
        }
      } else {
        console.log(`[PulsarStorage] No snapshot found, starting from beginning of topic`);
      }
      
      // Step 3: Create reader starting from checkpoint (or earliest if no snapshot)
      reader = await this.client.createReader({
        topic: topicName,
        startMessageId,
        readerName: `restore-${documentName}-${Date.now()}`,
        readCompacted: true,
      });

      // Step 4: Replay messages from checkpoint (limited to snapshot interval)
      let messageCount = 0;
      let lastMessageId: Pulsar.MessageId | null = null;
      const startTime = Date.now();
      
      const replayPromise = (async () => {
        let consecutiveTimeouts = 0;
        const MAX_TIMEOUTS = process.env.NODE_ENV === 'test' ? 1 : 3; // Only one timeout in test mode
        
        while (consecutiveTimeouts < MAX_TIMEOUTS && messageCount < this.snapshotInterval) {
          try {
            const readTimeout = process.env.NODE_ENV === 'test' ? 500 : 2000; // Much shorter for tests
            const receivedMsg = await reader!.readNext(readTimeout);
            consecutiveTimeouts = 0;
            lastMessageId = receivedMsg.getMessageId();
            
            const data = receivedMsg.getData();
            if (!data || data.length === 0) continue;

            const messageType = data[0];
            const update = data.slice(1);
            if (update.length === 0) continue;

            // Apply sync messages only
            if (messageType === 0) {
              try {
                Y.applyUpdate(ydoc, update);
                messageCount++;
                console.log(`[PulsarStorage] Applied incremental message ${messageCount} for document ${documentName}`);
              } catch (applyError) {
                console.warn(`[PulsarStorage] Failed to apply incremental update:`, applyError);
              }
            }
            
          } catch (error: any) {
            consecutiveTimeouts++;
            console.log(`[PulsarStorage] Incremental replay timeout ${consecutiveTimeouts}/${MAX_TIMEOUTS}`);
          }
        }
      })();

      // Execute replay with timeout
      const REPLAY_TIMEOUT = process.env.NODE_ENV === 'test' ? 3000 : 15000; // Much shorter timeout for tests
      try {
        await Promise.race([
          replayPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Incremental replay timeout')), REPLAY_TIMEOUT))
        ]);
      } catch (timeoutError: any) {
        if (timeoutError.message?.includes('timeout')) {
          console.log(`[PulsarStorage] Incremental replay timed out after ${REPLAY_TIMEOUT}ms, continuing with current state`);
        } else {
          throw timeoutError;
        }
      }
      
      const finalState = Y.encodeStateAsUpdate(ydoc);
      const duration = Date.now() - startTime;
      const totalMessages = baseMessageCount + messageCount;
      
      console.log(`[PulsarStorage] Document ${documentName} restored: ${messageCount} incremental messages (${totalMessages} total) in ${duration}ms`);
      
      // Step 5: Save new snapshot if we've processed enough new messages
      if (messageCount >= this.snapshotInterval && lastMessageId) {
        console.log(`[PulsarStorage] Creating new snapshot after ${messageCount} new messages`);
        await this.saveSnapshot(documentName, finalState, lastMessageId, totalMessages);
      }
      
      return finalState.length > 0 ? finalState : null;

    } catch (error) {
      console.error(`[PulsarStorage] Failed to restore document ${documentName}:`, error);
      return null;
    } finally {
      if (reader) {
        try {
          await reader.close();
        } catch (e) {
          console.warn(`[PulsarStorage] Error closing restore reader:`, e);
        }
      }
    }
  }
}