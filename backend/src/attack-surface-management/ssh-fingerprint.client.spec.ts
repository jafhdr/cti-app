import { createHash } from 'node:crypto';
import { Socket } from 'node:net';
import { SshFingerprintClient } from './ssh-fingerprint.client';

function fakeSocket(): Socket {
  const socket = new Socket();
  jest.spyOn(socket, 'connect').mockReturnValue(socket);
  jest.spyOn(socket, 'setTimeout').mockReturnValue(socket);
  jest.spyOn(socket, 'destroy').mockReturnValue(socket);
  return socket;
}

describe('SshFingerprintClient', () => {
  it('parses a split OpenSSH banner and hashes its exact bounded bytes', async () => {
    const socket = fakeSocket();
    const client = new SshFingerprintClient(() => socket);
    const pending = client.probe('192.0.2.1', 22);
    socket.emit('data', Buffer.from('SSH-2.0-Open'));
    socket.emit('data', Buffer.from('SSH_9.6p1 Ubuntu-3\r\n'));
    await expect(pending).resolves.toEqual({
      kind: 'VERIFIED', product: 'OpenSSH', version: '9.6.1', source: 'SSH_BANNER',
      bannerHash: createHash('sha256').update('SSH-2.0-OpenSSH_9.6p1 Ubuntu-3\r\n').digest('hex'), observedAt: expect.any(Date),
    });
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it.each(['SSH-1.99-OpenSSH_9.6\r\n', 'SSH-2.0-OpenSSH_9.6p1-extra\r\n', 'SSH-2.0-dropbear_2022.83\r\n'])('returns unknown for %s', async (banner) => {
    const socket = fakeSocket();
    const pending = new SshFingerprintClient(() => socket).probe('192.0.2.1', 22);
    socket.emit('data', Buffer.from(banner));
    await expect(pending).resolves.toEqual({ kind: 'UNKNOWN' });
  });

  it('returns unknown and closes at the byte cap', async () => {
    const socket = fakeSocket();
    const pending = new SshFingerprintClient(() => socket).probe('192.0.2.1', 22);
    socket.emit('data', Buffer.alloc(257, 65));
    await expect(pending).resolves.toEqual({ kind: 'UNKNOWN' });
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it('returns unknown on timeout and ignores late data', async () => {
    const socket = fakeSocket();
    const pending = new SshFingerprintClient(() => socket).probe('192.0.2.1', 22);
    socket.emit('timeout');
    socket.emit('data', Buffer.from('SSH-2.0-OpenSSH_9.6\r\n'));
    await expect(pending).resolves.toEqual({ kind: 'UNKNOWN' });
  });

  it('ends at the absolute deadline despite trickling banner bytes', async () => {
    jest.useFakeTimers();
    try {
      const socket = fakeSocket();
      const pending = new SshFingerprintClient(() => socket).probe('192.0.2.1', 22);
      socket.emit('data', Buffer.from('SSH-'));
      jest.advanceTimersByTime(500);
      socket.emit('data', Buffer.from('2.0-'));
      jest.advanceTimersByTime(499);
      socket.emit('data', Buffer.from('Open'));
      jest.advanceTimersByTime(1);
      await expect(pending).resolves.toEqual({ kind: 'UNKNOWN' });
      expect(socket.destroy).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
