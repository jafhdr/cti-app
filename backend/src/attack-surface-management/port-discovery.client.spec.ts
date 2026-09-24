import { createServer, Socket, type Server } from 'node:net';
import { PortDiscoveryClient } from './port-discovery.client';

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) {
        resolve(address.port);
        return;
      }
      reject(new Error('Test server did not expose a TCP port'));
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe('PortDiscoveryClient', () => {
  const client = new PortDiscoveryClient();

  it('reports open when a TCP listener accepts the connection', async () => {
    // Given
    const server = createServer((socket) => socket.end());
    const port = await listen(server);

    // When
    const result = await client.probe('127.0.0.1', port, 1_000);

    // Then
    expect(result).toEqual({ port, outcome: 'open' });
    await close(server);
  });

  it('reports closed when the operating system refuses the connection', async () => {
    // Given
    const server = createServer();
    const port = await listen(server);
    await close(server);

    // When
    const result = await client.probe('127.0.0.1', port, 1_000);

    // Then
    expect(result).toEqual({ port, outcome: 'closed' });
  });

  it('settles once and destroys the socket on timeout', async () => {
    // Given
    const socket = new Socket();
    jest.spyOn(socket, 'setTimeout').mockReturnValue(socket);
    jest.spyOn(socket, 'connect').mockReturnValue(socket);
    const destroy = jest.spyOn(socket, 'destroy').mockReturnValue(socket);
    const client = new PortDiscoveryClient(() => socket);

    // When
    const resultPromise = client.probe('192.0.2.10', 443, 1_000);
    socket.emit('timeout');
    socket.emit('error', Object.assign(new Error('late error'), { code: 'EHOSTUNREACH' }));

    // Then
    await expect(resultPromise).resolves.toEqual({ port: 443, outcome: 'timeout' });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('settles once and destroys the socket on a non-refused error', async () => {
    // Given
    const socket = new Socket();
    jest.spyOn(socket, 'setTimeout').mockReturnValue(socket);
    jest.spyOn(socket, 'connect').mockReturnValue(socket);
    const destroy = jest.spyOn(socket, 'destroy').mockReturnValue(socket);
    const client = new PortDiscoveryClient(() => socket);

    // When
    const resultPromise = client.probe('192.0.2.10', 443, 1_000);
    socket.emit('error', Object.assign(new Error('host unreachable'), { code: 'EHOSTUNREACH' }));
    socket.emit('timeout');

    // Then
    await expect(resultPromise).resolves.toEqual({ port: 443, outcome: 'failed', error: 'EHOSTUNREACH' });
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
