import { Inject, Injectable, Optional } from '@nestjs/common';
import { Socket } from 'node:net';

export const PORT_PROBE_OUTCOMES = ['open', 'closed', 'timeout', 'failed'] as const;
export type PortProbeOutcome = (typeof PORT_PROBE_OUTCOMES)[number];

export type PortProbeResult = {
  readonly port: number;
  readonly outcome: PortProbeOutcome;
  readonly error?: string;
};

type SocketFactory = () => Socket;
export const PORT_DISCOVERY_SOCKET_FACTORY = Symbol('PORT_DISCOVERY_SOCKET_FACTORY');

@Injectable()
export class PortDiscoveryClient {
  private readonly createSocket: SocketFactory;

  constructor(
    @Optional() @Inject(PORT_DISCOVERY_SOCKET_FACTORY) createSocket?: SocketFactory,
  ) {
    this.createSocket = createSocket ?? (() => new Socket());
  }

  probe(target: string, port: number, timeoutMs: number): Promise<PortProbeResult> {
    return new Promise((resolve) => {
      const socket = this.createSocket();
      let settled = false;
      const finish = (result: PortProbeResult): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish({ port, outcome: 'open' }));
      socket.once('timeout', () => finish({ port, outcome: 'timeout' }));
      socket.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ECONNREFUSED') {
          finish({ port, outcome: 'closed' });
          return;
        }
        if (error.code === 'ETIMEDOUT') {
          finish({ port, outcome: 'timeout' });
          return;
        }
        finish({ port, outcome: 'failed', error: error.code ?? error.message });
      });
      socket.connect({ host: target, port });
    });
  }
}
