import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { actionSchema, connectorConfig, sign, stateSchema, toolResponseSchema, validSignature, validTimestamp, type SandboxToolResponse } from './sandbox-contract';

@Injectable()
export class SandboxClient {
  private async send(path: '/v1/action' | '/v1/state', input: object): Promise<SandboxToolResponse> {
    const { endpoint, secret } = connectorConfig();
    const body = JSON.stringify(input);
    const response = await fetch(`${endpoint}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-soar-signature': sign(body, secret) }, body, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`SANDBOX_HTTP_${response.status}`);
    const raw = await response.text();
    if (!validSignature(raw, response.headers.get('x-soar-signature') ?? undefined, secret)) throw new Error('SANDBOX_RESPONSE_SIGNATURE');
    const parsed = toolResponseSchema.parse(JSON.parse(raw));
    if (!validTimestamp(parsed.timestamp) || parsed.requestId !== (input as { requestId: string }).requestId || parsed.tenantId !== (input as { tenantId: string }).tenantId || parsed.target !== (input as { target: string }).target) throw new Error('SANDBOX_RESPONSE_MISMATCH');
    if (parsed.operation !== (path === '/v1/state' ? 'READ_STATE' : (input as { operation: 'BLOCK_DOMAIN' | 'UNBLOCK_DOMAIN' }).operation)) throw new Error('SANDBOX_RESPONSE_MISMATCH');
    return parsed;
  }

  action(input: { requestId: string; tenantId: string; target: string; operation: 'BLOCK_DOMAIN' | 'UNBLOCK_DOMAIN' }): Promise<SandboxToolResponse> {
    return this.send('/v1/action', actionSchema.parse({ version: 1, ...input, timestamp: Date.now(), nonce: randomUUID() }));
  }

  state(input: { tenantId: string; target: string }): Promise<SandboxToolResponse> {
    return this.send('/v1/state', stateSchema.parse({ version: 1, requestId: randomUUID(), ...input, timestamp: Date.now(), nonce: randomUUID() }));
  }
}
