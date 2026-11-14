import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const actionSchema = z.object({
  version: z.literal(1), requestId: z.uuid(), tenantId: z.string().min(1),
  operation: z.enum(['BLOCK_DOMAIN', 'UNBLOCK_DOMAIN']),
  target: z.string().max(253).regex(/^(?:[a-z0-9-]+\.)+[a-z0-9-]+\.test$/),
  timestamp: z.number().int(), nonce: z.uuid(),
}).strict();
export const stateSchema = z.object({ version: z.literal(1), requestId: z.uuid(), tenantId: z.string().min(1), target: actionSchema.shape.target, timestamp: z.number().int(), nonce: z.uuid() }).strict();
export const toolResponseSchema = z.object({ version: z.literal(1), requestId: z.uuid(), tenantId: z.string().min(1), target: actionSchema.shape.target, blocked: z.boolean(), operation: z.enum(['BLOCK_DOMAIN', 'UNBLOCK_DOMAIN', 'READ_STATE']), timestamp: z.number().int() }).strict();
export type SandboxAction = z.infer<typeof actionSchema>;
export type SandboxStateQuery = z.infer<typeof stateSchema>;
export type SandboxToolResponse = z.infer<typeof toolResponseSchema>;

export function sign(body: string, secret: string): string {
  if (secret.length < 32) throw new Error('Sandbox secret must be at least 32 characters');
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function validSignature(body: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(sign(body, secret), 'hex'), Buffer.from(signature, 'hex'));
}

export function validTimestamp(timestamp: number, now = Date.now()): boolean {
  return Math.abs(now - timestamp) <= 30_000;
}

export function connectorConfig(): { endpoint: string; secret: string } {
  const endpoint = process.env.SICTI_SOAR_SANDBOX_URL ?? '';
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('Sandbox connector must use local loopback');
  const secret = process.env.SICTI_SOAR_SANDBOX_SECRET ?? '';
  if (secret.length < 32) throw new Error('Sandbox secret must be at least 32 characters');
  return { endpoint: parsed.origin, secret };
}
