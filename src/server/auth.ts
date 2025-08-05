import { AuthStrategy, VerifyClientDoneCallback } from '../types';
import { IncomingMessage } from 'http';

/**
 * A default authentication strategy that allows all connections.
 */
export class NoAuthStrategy implements AuthStrategy {
  /**
   * Allows all incoming WebSocket connection requests.
   * @param info - An object containing the request details.
   * @param done - The callback to invoke with the authentication result.
   */
  verifyClient(info: { origin: string; secure: boolean; req: IncomingMessage }, done: VerifyClientDoneCallback): void {
    done(true);
  }
}
