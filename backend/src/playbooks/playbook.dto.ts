import { z } from 'zod';

const id = z.string().min(1).max(160);
export const triggerPlaybookSchema = z.object({ alertId: id, caseId: id.optional(), idempotencyKey: z.uuid() }).strict();
export const decidePlaybookSchema = z.object({ kind: z.enum(['CONFIRM', 'APPROVE', 'REJECT']), reason: z.string().trim().min(10).max(1000) }).strict();
export const recoverSandboxSchema = z.object({ reason: z.string().trim().min(10).max(1000), idempotencyKey: z.uuid() }).strict();
export type TriggerPlaybook = z.infer<typeof triggerPlaybookSchema>;
export type DecidePlaybook = z.infer<typeof decidePlaybookSchema>;
export type RecoverSandbox = z.infer<typeof recoverSandboxSchema>;
