import express from 'express';
import 'dotenv/config'; // Load environment variables from .env file
import http from 'http';
import * as ws from 'ws';
import { setupWSConnection, createPulsarClient } from './utils';
import Pulsar from 'pulsar-client';
import { NoAuthStrategy } from './auth';
import { ServerConfig, PulsarClientContainer, AuthStrategy, YjsPulsarServer } from '../types';
import { cleanupManager } from './cleanup';
export { ServerConfig, AuthStrategy, YjsPulsarServer };

export const startServer = async (config: ServerConfig): Promise<YjsPulsarServer> => {
    const pulsarClientContainer = {
        client: config.pulsarClient ?? createPulsarClient(config)
    };

    const app = express();
    const httpServer = http.createServer(app);
    const authStrategy = config.auth || new NoAuthStrategy();

    const wss = new ws.WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (request: http.IncomingMessage, socket: any, head: Buffer) => {
        authStrategy.verifyClient({ origin: request.headers.origin as string, secure: true, req: request }, (verified: boolean, code?: number, message?: string) => {
            if (!verified) {
                socket.write(`HTTP/1.1 ${code} ${message}\r\n\r\n`);
                socket.destroy();
                return;
            }

            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        });
    });

    wss.on('connection', (conn: ws.WebSocket, req: http.IncomingMessage) => {
        setupWSConnection(conn, req, { pulsarClientContainer, pulsarConfig: config })
            .catch(err => {
                console.error('Failed to setup WebSocket connection', err);
                conn.close();
            });
    });

    const stop = async () => {
        await cleanupManager.waitForAll();
        await new Promise(resolve => wss.close(resolve));
        if (!config.pulsarClient) {
            await pulsarClientContainer.client.close();
        }
        await new Promise(resolve => httpServer.close(resolve));
    };

    await new Promise<void>(resolve => httpServer.listen({ port: config.port }, resolve));

    if (config.port !== 0) {
        console.log(`Server listening on http://localhost:${config.port}`);
    }

    return { httpServer, wss, pulsarClientContainer, cleanupManager, stop };
}

if (require.main === module) {
    const config: ServerConfig = {
        port: parseInt(process.env.PORT || '8080'),
        pulsarUrl: process.env.ADDON_PULSAR_BINARY_URL || 'pulsar://localhost:6650',
        pulsarToken: process.env.ADDON_PULSAR_TOKEN || '',
        pulsarTenant: process.env.ADDON_PULSAR_TENANT || 'public',
        pulsarNamespace: process.env.ADDON_PULSAR_NAMESPACE || 'default',
        pulsarTopicPrefix: process.env.PULSAR_TOPIC_PREFIX || 'yjs-doc-',
    };
    startServer(config).catch(err => {
        console.error('Failed to start server', err);
        process.exit(1);
    });
}
