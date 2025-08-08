import express from 'express';
import 'dotenv/config';
import { startServer, ServerConfig } from './index';
import path from 'path';

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
  
  // Temporarily disable storage to prevent segfaults while we debug
  console.log('⚠️  Temporarily disabling storage to prevent segfaults');
  process.env.STORAGE_TYPE = 'none';

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
    
    // Intégrer Express avec le serveur HTTP existant
    const server = yjsServer.httpServer;
    server.removeAllListeners('request');
    server.on('request', app);
    
    console.log(`✅ Demo server running on http://localhost:${port}`);
    console.log(`🔗 WebSocket server ready for Yjs collaboration`);
    console.log(`💡 Open multiple tabs to test real-time collaboration!`);
    
    // Enhanced graceful shutdown handling
    const gracefulShutdown = async (signal: string) => {
      console.log(`📝 Received ${signal}, shutting down gracefully...`);
      try {
        // Set a timeout for shutdown to prevent hanging
        const shutdownTimeout = setTimeout(() => {
          console.error('⚠️ Shutdown timeout reached, forcing exit');
          process.exit(1);
        }, 30000); // 30 second timeout

        await yjsServer.stop();
        clearTimeout(shutdownTimeout);
        console.log('✅ Server shut down successfully');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    // Handle multiple shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
    
    // Handle uncaught exceptions to prevent segfaults
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught exception:', error);
      console.log('🔄 Attempting graceful shutdown after uncaught exception...');
      gracefulShutdown('uncaughtException').catch(() => {
        console.error('❌ Failed to shutdown gracefully after uncaught exception');
        process.exit(1);
      });
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled promise rejection at:', promise, 'reason:', reason);
      // Don't exit on promise rejections, just log them
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