import { ForbiddenException } from '@nestjs/common';

export function monitoringSimulatorEndpoint(value: string | undefined): string {
  if (!value) throw new ForbiddenException('Simulator endpoint unavailable');
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/v1/collect' || url.search || url.hash) {
    throw new ForbiddenException('Simulator must use the fixed loopback path');
  }
  return url.toString();
}
