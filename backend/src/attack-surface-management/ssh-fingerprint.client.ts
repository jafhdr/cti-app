import { createHash } from 'node:crypto';
import { Socket } from 'node:net';

export type SshFingerprint =
  | { readonly kind: 'VERIFIED'; readonly product: 'OpenSSH'; readonly version: string; readonly source: 'SSH_BANNER'; readonly bannerHash: string; readonly observedAt: Date }
  | { readonly kind: 'UNKNOWN' };

type SocketFactory = () => Socket;
const MAX_BANNER_BYTES = 256;
const UNKNOWN: SshFingerprint = { kind: 'UNKNOWN' };

export class SshFingerprintClient {
  constructor(private readonly createSocket: SocketFactory = () => new Socket()) {}

  probe(host: string, port: number): Promise<SshFingerprint> {
    return new Promise((resolve) => {
      const socket = this.createSocket();
      const chunks: Buffer[] = [];
      let length = 0;
      let settled = false;
      const deadline = setTimeout(() => finish(UNKNOWN), 1_000);
      const finish = (result: SshFingerprint): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(1_000);
      socket.on('data', (chunk: Buffer) => {
        if (settled) return;
        length += chunk.length;
        if (length > MAX_BANNER_BYTES) {
          finish(UNKNOWN);
          return;
        }
        chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        const newline = bytes.indexOf(10);
        if (newline < 0) return;
        if (newline !== bytes.length - 1) {
          finish(UNKNOWN);
          return;
        }
        const banner = bytes.toString('ascii');
        const match = /^SSH-2\.0-OpenSSH_(\d+)\.(\d+)(?:p(\d+))?(?: [\x20-\x7e]+)?\r?\n$/.exec(banner);
        if (!match) {
          finish(UNKNOWN);
          return;
        }
        const [, major, minor, patch] = match;
        if (major === undefined || minor === undefined) {
          finish(UNKNOWN);
          return;
        }
        const version = `${Number(major)}.${Number(minor)}${patch === undefined ? '' : `.${Number(patch)}`}`;
        finish({ kind: 'VERIFIED', product: 'OpenSSH', version, source: 'SSH_BANNER', bannerHash: createHash('sha256').update(bytes).digest('hex'), observedAt: new Date() });
      });
      socket.once('timeout', () => finish(UNKNOWN));
      socket.once('error', () => finish(UNKNOWN));
      socket.once('end', () => finish(UNKNOWN));
      socket.connect({ host, port });
    });
  }
}
