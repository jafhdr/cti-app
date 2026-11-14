import { z } from 'zod';

const id = z.string().trim().min(1).max(160);
export const createNextStepRunSchema = z.object({
  idempotencyKey: id,
  threatActorId: id.optional(),
  campaignId: id.optional(),
  asOf: z.iso.datetime({ offset: true }),
  horizonDays: z.number().int().min(1).max(90),
}).strict().refine(value => Boolean(value.threatActorId) !== Boolean(value.campaignId), 'Select exactly one scope');

export const reviewNextStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('DISPOSITION'), disposition: z.enum(['ACCEPT_FOR_INVESTIGATION', 'DISMISSED', 'ALREADY_OBSERVED']), expectedReviewId: id.nullable(), reason: z.string().trim().min(10).max(2000) }).strict(),
  z.object({ kind: z.literal('OUTCOME'), outcome: z.enum(['VERIFIED', 'UNCERTAIN', 'UNOBSERVABLE']), outcomeObservationId: id.optional(), expectedReviewId: id.nullable(), reason: z.string().trim().min(10).max(2000) }).strict(),
]);
export type CreateNextStepRun = z.infer<typeof createNextStepRunSchema>;
export type ReviewNextStep = z.infer<typeof reviewNextStepSchema>;
