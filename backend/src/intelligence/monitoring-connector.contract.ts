import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const date = z.iso.datetime({ offset: true });
export const collectionRequestSchema = z.object({
  version: z.literal(1), requestId: z.uuid(), tenantId: z.string().min(1), sourceId: z.string().min(1),
  providerKey: z.string().regex(/^qa-fixture-[a-z0-9-]{1,60}$/), targetDomain: z.string().regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/),
  requestedAt: date,
}).strict();
export const collectionResponseSchema = z.object({
  version: z.literal(1), requestId: z.uuid(), tenantId: z.string().min(1), sourceId: z.string().min(1),
  providerKey: z.string(), coverageLabel: z.string().min(1).max(80), publishedAt: date,
  observations: z.array(z.object({
    providerEventKey: z.string().regex(/^[a-z0-9-]{1,100}$/),
    kind: z.enum(['BRAND_IMPERSONATION', 'PHISHING_DOMAIN', 'CORPORATE_DATA_EXPOSURE', 'CREDENTIAL_EXPOSURE']),
    domain: z.string().min(4).max(253).optional(), identity: z.email().optional(),
    metadataCategory: z.enum(['LOOKALIKE_DOMAIN', 'PHISHING_SIGNAL', 'DATASET_MENTION', 'ACCOUNT_PRESENT']),
    evidenceRef: z.string().regex(/^qa:\/\/[a-z0-9-]{1,60}\/[a-z0-9-]{1,100}$/),
    evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/), observedAt: date,
    tlp: z.enum(['CLEAR', 'GREEN', 'AMBER', 'AMBER_STRICT', 'RED']),
  }).strict()).max(20),
}).strict();
export type CollectionRequest = z.infer<typeof collectionRequestSchema>;
export type CollectionResponse = z.infer<typeof collectionResponseSchema>;

export function connectorSecret(): Buffer {
  const encoded = process.env.SICTI_MONITORING_SIMULATOR_SECRET;
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new Error('Simulator secret unavailable');
  const secret = Buffer.from(encoded, 'base64url');
  if (secret.length !== 32) throw new Error('Simulator secret invalid');
  return secret;
}

export function signConnector(body: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function verifyConnector(body: string, signature: string | null, secret: Buffer): boolean {
  if (!signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(signConnector(body, secret), 'hex'));
}

export function evidenceDigest(eventKey: string, domain: string, observedAt: string): string {
  return createHash('sha256').update(`sicti-qa-evidence-v1\0${eventKey}\0${domain}\0${observedAt}`).digest('hex');
}
