import { z } from 'zod';

const id = z.string().min(1).max(160);
const date = z.iso.datetime({ offset: true });
const tlp = z.enum(['CLEAR', 'GREEN', 'AMBER', 'AMBER_STRICT', 'RED']);

export const watchSchema = z.object({ kind: z.enum(['DOMAIN', 'BRAND', 'IDENTITY_HASH']), value: z.string().min(3).max(253), assetId: id.optional(), expiresAt: date.optional() }).strict();
export const watchUpdateSchema = z.object({ active: z.boolean(), expiresAt: date.nullable().optional() }).strict();
export const sourceSchema = z.object({ catalogSourceId: id, providerKey: z.string().regex(/^qa-fixture-[a-z0-9-]{1,60}$/), retentionDays: z.number().int().min(1).max(90) }).strict();
export const sourceConnectorSchema = z.object({ intervalMinutes: z.number().int().min(1).max(1440) }).strict();
export const redactSchema = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
export const observationSchema = z.object({
  sourceId: id, providerEventKey: z.string().regex(/^[a-z0-9-]{1,100}$/),
  kind: z.enum(['CREDENTIAL_EXPOSURE', 'CORPORATE_DATA_EXPOSURE', 'BRAND_IMPERSONATION', 'PHISHING_DOMAIN']),
  domain: z.string().min(4).max(253).optional(), identity: z.email().max(253).optional(),
  metadataCategory: z.enum(['ACCOUNT_PRESENT', 'DATASET_MENTION', 'LOOKALIKE_DOMAIN', 'PHISHING_SIGNAL']),
  evidenceRef: z.string().min(1).max(180), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: date, tlp,
}).strict().superRefine((value, context) => {
  if (value.identity && value.kind !== 'CREDENTIAL_EXPOSURE') context.addIssue({ code: 'custom', path: ['identity'], message: 'Identity is limited to credential metadata' });
  if (value.kind === 'CREDENTIAL_EXPOSURE' && !value.identity) context.addIssue({ code: 'custom', path: ['identity'], message: 'Credential metadata requires an identity' });
});
export const reviewSchema = z.object({
  status: z.enum(['UNDER_REVIEW', 'CONFIRMED', 'FALSE_POSITIVE', 'RESOLVED']),
  expectedStatus: z.enum(['NEW', 'UNDER_REVIEW', 'CONFIRMED', 'FALSE_POSITIVE']),
  reason: z.string().trim().min(10).max(1000),
}).strict();
export const caseLinkSchema = z.object({ caseId: id.optional(), createCase: z.boolean().optional() }).strict().refine(value => Boolean(value.caseId) !== Boolean(value.createCase), { message: 'Select existing case or create one' });

export type WatchInput = z.infer<typeof watchSchema>;
export type WatchUpdate = z.infer<typeof watchUpdateSchema>;
export type SourceInput = z.infer<typeof sourceSchema>;
export type ObservationInput = z.infer<typeof observationSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export type CaseLinkInput = z.infer<typeof caseLinkSchema>;
