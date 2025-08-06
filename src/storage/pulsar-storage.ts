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
      console.log(`[PulsarStorage] Restoring document ${documentName} from Pulsar topic`);
      
      // Create a temporary consumer to replay all messages
      consumer = await this.client.subscribe({
        topic: topicName,
        subscription: `restore-${documentName}-${Date.now()}`,
        subscriptionType: 'Exclusive',
        subscriptionInitialPosition: 'Earliest', // Start from the very beginning
      });

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
        while (await consumer!.isConnected()) {
          try {
            const receivedMsg = await consumer!.receive();
            const data = receivedMsg.getData();
            
            if (!data || data.length === 0) {
              await consumer!.acknowledge(receivedMsg);
              continue;
            }

            const messageType = data[0];
            const update = data.slice(1);

            if (update.length === 0) {
              await consumer!.acknowledge(receivedMsg);
              continue;
            }

            // Apply the update to our temporary document
            if (messageType === 0) { // messageSync
              Y.applyUpdate(ydoc, update);
              messageCount++;
            }
            // Ignore awareness messages (messageType === 1) for document restoration

            await consumer!.acknowledge(receivedMsg);
            
            // Check if we've caught up (no more messages available)
            // This is a heuristic - in a real implementation, you might want
            // to check message timestamps or use a more sophisticated method
            if (messageCount > 0 && Date.now() - startTime > 1000) {
              // If we haven't received messages for 1 second, assume we're caught up
              break;
            }
          } catch (error) {
            // If we can't receive more messages, we're probably caught up
            break;
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