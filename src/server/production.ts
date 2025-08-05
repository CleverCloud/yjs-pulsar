import express from 'express';
import 'dotenv/config';
import { startServer, ServerConfig } from './index';
import path from 'path';

const __dirname = path.dirname(__filename);

async function startProductionServer() {
  const port = parseInt(process.env.PORT || '8080');
  
  // Configuration Pulsar depuis les variables d'environnement Clever Cloud
  const config: ServerConfig = {
    port,
    pulsarUrl: process.env.ADDON_PULSAR_BINARY_URL || 'pulsar://localhost:6650',
    pulsarToken: process.env.ADDON_PULSAR_TOKEN || '',
    pulsarTenant: process.env.ADDON_PULSAR_TENANT || 'public',
    pulsarNamespace: process.env.ADDON_PULSAR_NAMESPACE || 'default',
    pulsarTopicPrefix: process.env.PULSAR_TOPIC_PREFIX || 'yjs-demo-',
  };

  console.log('🚀 Starting Yjs Pulsar Demo Server...');
  console.log(`📡 Pulsar URL: ${config.pulsarUrl}`);
  console.log(`🏠 Port: ${port}`);

  try {
    // Démarrer le serveur Yjs avec WebSocket
    const yjsServer = await startServer(config);
    
    // Créer une app Express pour servir les fichiers statiques
    const app = express();
    
    // Servir les fichiers statiques de la demo depuis le dossier dist
    const demoPath = path.resolve(__dirname, '../../demo/dist');
    console.log(`📁 Serving demo from: ${demoPath}`);
    
    app.use(express.static(demoPath));
    
    // Route pour la demo
    app.get('/', (req, res) => {
      res.sendFile(path.join(demoPath, 'index.html'));
    });
    
    // API de santé
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        pulsar: {
          url: config.pulsarUrl,
          tenant: config.pulsarTenant,
          namespace: config.pulsarNamespace,
        }
      });
    });
    
    // Remplacer le serveur HTTP du serveur Yjs par notre app Express
    yjsServer.httpServer.on('request', app);
    
    console.log(`✅ Demo server running on http://localhost:${port}`);
    console.log(`🔗 WebSocket server ready for Yjs collaboration`);
    console.log(`💡 Open multiple tabs to test real-time collaboration!`);
    
    // Gestion de l'arrêt propre
    process.on('SIGTERM', async () => {
      console.log('📝 Shutting down gracefully...');
      await yjsServer.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Démarrer le serveur si ce fichier est exécuté directement
if (require.main === module) {
  startProductionServer().catch(console.error);
}

export { startProductionServer };