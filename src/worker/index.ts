import Pulsar from 'pulsar-client';
import { getStorage } from '../storage';
import 'dotenv/config';

export interface WorkerConfig {
  pulsarUrl: string;
  pulsarToken?: string;
  pulsarTenant: string;
  pulsarNamespace: string;
  pulsarTopicPrefix: string;
  pulsarSubscription: string;
}

export async function startWorker(config: WorkerConfig) {
  const storage = getStorage();

  if (!config.pulsarTenant || !config.pulsarNamespace) {
    throw new Error('PULSAR_TENANT and PULSAR_NAMESPACE must be provided in the configuration');
  }

  const topicPattern = `persistent://${config.pulsarTenant}/${config.pulsarNamespace}/${config.pulsarTopicPrefix}.*`;

  console.log('Starting Yjs-Pulsar worker...');

  const client = new Pulsar.Client({
    serviceUrl: config.pulsarUrl,
    authentication: config.pulsarToken ? new Pulsar.AuthenticationToken({ token: config.pulsarToken }) : undefined,
  });

  const consumer = await client.subscribe({
    topicsPattern: topicPattern,
    subscription: config.pulsarSubscription,
    subscriptionType: 'Shared',
  });

  console.log(`Worker subscribed to topics matching: ${topicPattern}`);
  console.log('Waiting for document updates...');

  while (true) {
    try {
      const msg = await consumer.receive();
      const topic = msg.getTopicName();
      const documentName = topic.split('/').pop()?.replace(config.pulsarTopicPrefix, '');
      const update = msg.getData();

      if (documentName) {
        console.log(`Received update for document: ${documentName}`);
        await storage.storeUpdate(documentName, update);
        console.log(`Stored update for document: ${documentName}`);
        await consumer.acknowledge(msg);
      } else {
        console.warn(`Could not determine document name from topic: ${topic}`);
        await consumer.acknowledge(msg);
      }
    } catch (error) {
      console.error('Error receiving or processing message:', error);
    }
  }
}

// Start the worker only if the script is executed directly
if (require.main === module) {
  const config: WorkerConfig = {
    pulsarUrl: process.env.ADDON_PULSAR_BINARY_URL || 'pulsar://localhost:6650',
    pulsarToken: process.env.ADDON_PULSAR_TOKEN,
    pulsarTenant: process.env.ADDON_PULSAR_TENANT || '',
    pulsarNamespace: process.env.ADDON_PULSAR_NAMESPACE || '',
    pulsarTopicPrefix: process.env.PULSAR_TOPIC_PREFIX || 'yjs-doc-',
    pulsarSubscription: 'yjs-worker-subscription',
  };

  startWorker(config).catch((error) => {
    console.error('Worker failed to start:', error);
    process.exit(1);
  });
}
