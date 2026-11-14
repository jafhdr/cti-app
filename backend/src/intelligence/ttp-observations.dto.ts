import { z } from 'zod';

const identifier = z.string().trim().min(1).max(160);
const confidence = z.number().int().min(0).max(100);
const timestamp = z.iso.datetime({ offset: true });

export const createTtpObservationSchema = z.object({
  idempotencyKey: identifier,
  threatActorId: identifier.optional(),
  campaignId: identifier.optional(),
  mitreTechniqueId: identifier,
  attackVersion: identifier,
  sirEvidenceId: identifier,
  attributionBasis: z.string().trim().min(10).max(2000),
  observedStartAt: timestamp,
  observedEndAt: timestamp,
  timePrecision: z.enum(['INSTANT', 'HOUR', 'DAY', 'INTERVAL']),
  tlp: z.enum(['CLEAR', 'GREEN', 'AMBER', 'AMBER_STRICT', 'RED']),
  actorConfidence: confidence.optional(),
  techniqueConfidence: confidence,
}).strict().refine(value => Boolean(value.threatActorId || value.campaignId), { message: 'Actor or campaign scope required' });

export const reviewTtpObservationSchema = z.object({
  status: z.enum(['CONFIRMED', 'DISPUTED', 'REJECTED']),
  expectedStatus: z.enum(['CANDIDATE', 'CONFIRMED', 'DISPUTED']),
  reason: z.string().trim().min(10).max(2000),
}).strict();

export type CreateTtpObservation = z.infer<typeof createTtpObservationSchema>;
export type ReviewTtpObservation = z.infer<typeof reviewTtpObservationSchema>;
