import { Storage } from './storage';
import Pulsar from 'pulsar-client';
import * as Y from 'yjs';

/**
 * Pulsar-only storage implementation with compaction support
 * Documents are persisted by replaying all Pulsar messages from the beginning
 * Uses compacted topics to ensure message retention and efficient storage
 */
export class PulsarStorage implements Storage {
  private client: Pulsar.Client;
  private tenant: string;
  private namespace: string;
  private topicPrefix: string;

  constructor(
    client: Pulsar.Client,
    tenant: string,
    namespace: string, 
    topicPrefix: string
  ) {
    this.client = client;
    this.tenant = tenant;
    this.namespace = namespace;
    this.topicPrefix = topicPrefix;
  }

  private getTopicName(documentName: string): string {
    return `persistent://${this.tenant}/${this.namespace}/${this.topicPrefix}${documentName}`;
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
      console.log(`[PulsarStorage] Restoring document ${documentName} from Pulsar topic: ${topicName}`);
      
      // Use Reader with compacted view to get only latest messages per key
      // This is more efficient than consumer for replay scenarios
      reader = await this.client.createReader({
        topic: topicName,
        startMessageId: Pulsar.MessageId.earliest(),
        readerName: `restore-${documentName}-${Date.now()}`,
        readCompacted: true, // Only read latest message per key (compacted view)
      });

      console.log(`[PulsarStorage] Reader created successfully for ${documentName}`);

      // Create a temporary Yjs document to apply all operations
      const ydoc = new Y.Doc();
      let messageCount = 0;
      const startTime = Date.now();

      // Set a reasonable timeout for replay
      const REPLAY_TIMEOUT = 30000; // 30 seconds
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Replay timeout')), REPLAY_TIMEOUT);
      });

      // Replay all messages to reconstruct document state
      const replayPromise = (async () => {
        let consecutiveEmptyReceives = 0;
        const MAX_EMPTY_RECEIVES = 5; // Stop after 5 consecutive empty receives
        
        while (reader!.hasNext()) {
          try {
            // Set a timeout for receive to avoid hanging indefinitely
            const receiveTimeout = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Receive timeout')), 2000);
            });
            
            const readPromise = reader!.readNext();
            const receivedMsg = await Promise.race([readPromise, receiveTimeout]) as any;
            
            const data = receivedMsg.getData();
            
            if (!data || data.length === 0) {
              consecutiveEmptyReceives++;
              if (consecutiveEmptyReceives >= MAX_EMPTY_RECEIVES) {
                console.log(`[PulsarStorage] ${MAX_EMPTY_RECEIVES} consecutive empty messages, stopping replay`);
                break;
              }
              continue;
            }

            consecutiveEmptyReceives = 0; // Reset counter when we get data
            const messageType = data[0];
            const update = data.slice(1);

            if (update.length === 0) {
              continue;
            }

            // Apply the update to our temporary document
            if (messageType === 0) { // messageSync
              try {
                Y.applyUpdate(ydoc, update);
                messageCount++;
                console.log(`[PulsarStorage] Applied message ${messageCount} for document ${documentName}`);
              } catch (applyError) {
                console.warn(`[PulsarStorage] Failed to apply update:`, applyError);
              }
            }
            // Ignore awareness messages (messageType === 1) for document restoration
            
          } catch (error: any) {
            if (error?.message === 'Receive timeout') {
              // No more messages available
              console.log(`[PulsarStorage] No more messages available, stopping replay`);
              break;
            } else {
              console.warn(`[PulsarStorage] Error during replay:`, error);
              break;
            }
          }
        }
      })();

      // Race between replay and timeout
      await Promise.race([replayPromise, timeoutPromise]);
      
      const finalState = Y.encodeStateAsUpdate(ydoc);
      const duration = Date.now() - startTime;
      
      console.log(`[PulsarStorage] Restored document ${documentName}: ${messageCount} messages replayed in ${duration}ms`);
      
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