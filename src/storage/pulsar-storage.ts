import { Storage } from './storage';
import Pulsar from 'pulsar-client';
import * as Y from 'yjs';

/**
 * Pulsar-only storage implementation
 * Documents are persisted by replaying all Pulsar messages from the beginning
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

  async getDoc(documentName: string): Promise<Uint8Array | null> {
    const topicName = this.getTopicName(documentName);
    let consumer: Pulsar.Consumer | null = null;
    
    try {
      console.log(`[PulsarStorage] Restoring document ${documentName} from Pulsar topic: ${topicName}`);
      
      // Create a temporary consumer to replay all messages
      consumer = await this.client.subscribe({
        topic: topicName,
        subscription: `restore-${documentName}-${Date.now()}`,
        subscriptionType: 'Exclusive',
        subscriptionInitialPosition: 'Earliest', // Start from the very beginning
      });

      console.log(`[PulsarStorage] Consumer created successfully for ${documentName}`);

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
        
        while (await consumer!.isConnected()) {
          try {
            // Set a timeout for receive to avoid hanging indefinitely
            const receiveTimeout = new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Receive timeout')), 2000);
            });
            
            const receivePromise = consumer!.receive();
            const receivedMsg = await Promise.race([receivePromise, receiveTimeout]) as any;
            
            const data = receivedMsg.getData();
            
            if (!data || data.length === 0) {
              await consumer!.acknowledge(receivedMsg);
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
              await consumer!.acknowledge(receivedMsg);
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

            await consumer!.acknowledge(receivedMsg);
            
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
      if (consumer) {
        try {
          await consumer.close();
        } catch (e) {
          console.warn(`[PulsarStorage] Error closing restore consumer:`, e);
        }
      }
    }
  }
}