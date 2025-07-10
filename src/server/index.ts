import express from 'express';
import http from 'http';
import * as ws from 'ws';
import { setupWSConnection } from './utils';
import Pulsar from 'pulsar-client';

export interface ServerConfig {
    port: number;
    pulsarUrl: string;
    pulsarToken?: string;
    pulsarTenant: string;
    pulsarNamespace: string;
    pulsarTopicPrefix: string;
}

export async function startServer(config: ServerConfig) {
    const app = express();
    const server = http.createServer(app);
    const wss = new ws.WebSocketServer({ server });

    const pulsar = new Pulsar.Client({
        serviceUrl: config.pulsarUrl,
        authentication: config.pulsarToken ? new Pulsar.AuthenticationToken({ token: config.pulsarToken }) : undefined,
    });

    wss.on('connection', (conn, req) => {
        setupWSConnection(conn, req, { pulsarClient: pulsar, pulsarConfig: config })
            .catch(err => {
                console.error('Failed to setup WebSocket connection', err);
                conn.close();
            });
    });

    server.listen(config.port, () => {
        console.log(`Server listening on http://localhost:${config.port}`);
    });

    return { server, wss, pulsar };
}

if (require.main === module) {
    const config: ServerConfig = {
        port: parseInt(process.env.PORT || '8080'),
        pulsarUrl: process.env.ADDON_PULSAR_BINARY_URL || 'pulsar://localhost:6650',
        pulsarToken: process.env.ADDON_PULSAR_TOKEN,
        pulsarTenant: process.env.ADDON_PULSAR_TENANT || 'public',
        pulsarNamespace: process.env.ADDON_PULSAR_NAMESPACE || 'default',
        pulsarTopicPrefix: process.env.PULSAR_TOPIC_PREFIX || 'yjs-doc-',
    };
    startServer(config);
}
