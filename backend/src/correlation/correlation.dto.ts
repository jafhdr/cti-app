import { z } from 'zod';

export const telemetrySchema = z.object({
  tenantId: z.string().min(1).optional(),
  sourceKey: z.string().min(4).max(160),
  observedAt: z.iso.datetime({ offset: true }),
  observableType: z.enum(['IP_ADDRESS', 'DOMAIN', 'URL', 'FILE_HASH', 'EMAIL']),
  observableValue: z.string().min(2).max(2048),
  ioaKind: z.enum(['DNS_QUERY', 'HTTP_REQUEST', 'IP_CONNECTION', 'HASH_EXECUTION', 'EMAIL_CONTACT']),
  sourceName: z.string().min(2).max(100),
  confidence: z.number().int().min(0).max(100),
  tlp: z.enum(['CLEAR', 'GREEN', 'AMBER', 'AMBER_STRICT', 'RED']),
}).strict().superRefine((value, ctx) => {
  if (value.observableType === 'URL') {
    try { const parsed = new URL(value.observableValue); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol'); }
    catch { ctx.addIssue({ code: 'custom', path: ['observableValue'], message: 'Invalid HTTP URL' }); }
  }
});

export type TelemetryInput = z.infer<typeof telemetrySchema>;
