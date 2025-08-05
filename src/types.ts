import Pulsar from 'pulsar-client';
import * as http from 'http';
import { WebSocketServer as Server } from 'ws';
import { CleanupManager } from './server/cleanup';

export type VerifyClientDoneCallback = (res: boolean, code?: number, message?: string, headers?: http.OutgoingHttpHeaders) => void;

export interface AuthStrategy {
    verifyClient(info: { origin: string; secure: boolean; req: http.IncomingMessage }, done: VerifyClientDoneCallback): void;
}

export interface PulsarClientContainer {
    client: Pulsar.Client;
}

export interface ServerConfig {
    port: number;
    pulsarUrl: string;
    pulsarToken?: string;
    pulsarTenant: string;
    pulsarNamespace: string;
    pulsarTopicPrefix: string;
    pulsarOperationTimeoutSeconds?: number;
    pulsarClient?: Pulsar.Client;
    auth?: AuthStrategy;
}

export interface YjsPulsarServer {
    httpServer: http.Server;
    wss: Server;
    pulsarClientContainer: PulsarClientContainer;
    cleanupManager: CleanupManager;
    stop: () => Promise<void>;
}
