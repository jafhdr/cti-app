import { z } from 'zod';

const iso = z.iso.datetime({ offset: true });
const id = z.string().min(1).max(160);
const tlp = z.enum(['CLEAR', 'GREEN', 'AMBER', 'AMBER_STRICT', 'RED']);
const observation = z.object({
  id, techniqueId: id, campaignId: id.nullable(), sourceLineageId: id, externalId: id,
  attackVersion: id, observedStartAt: iso, observedEndAt: iso,
  actorConfidence: z.number().int().min(0).max(100).nullable(), techniqueConfidence: z.number().int().min(0).max(100),
  status: z.enum(['CANDIDATE', 'CONFIRMED', 'DISPUTED', 'REJECTED']), tlp,
}).strict();
const catalogTechnique = z.object({ id, externalId: id, name: id, tactic: id }).strict();
const snapshot = z.object({
  engineVersion: z.literal('deterministic-1'), ruleVersion: z.literal('explicit-transitions-1'),
  asOf: iso, horizonDays: z.number().int().min(1).max(90), scope: id,
  observations: z.array(observation).max(200), catalog: z.array(catalogTechnique),
}).strict();
const scoreComponents = z.object({ base: z.number().int(), attribution: z.number().int(), techniqueMapping: z.number().int(), corroboration: z.number().int(), contradiction: z.number().int(), priorObservation: z.number().int() }).strict();
const candidate = z.object({
  techniqueId: id, rank: z.number().int().positive(), supportScore: z.number().int().min(0).max(100),
  supportingObservationIds: z.array(id), contradictingObservationIds: z.array(id),
  ruleTrace: z.object({ ruleVersion: z.literal('explicit-transitions-1'), ruleId: id, explanation: z.string(), components: scoreComponents }).strict(),
}).strict();
const availability = z.object({ observationId: id, createdAt: iso, ingestedAt: iso, reviewedAt: iso.nullable() }).strict();
const catalogAvailability = z.object({ techniqueId: id, createdAt: iso, updatedAt: iso }).strict();
const monitoring = z.object({ complete: z.boolean(), startAt: iso, endAt: iso, sourceLineageIds: z.array(id).min(1) }).strict();
const adjudication = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('VERIFIED_TECHNIQUE'), techniqueId: id, observationId: id, sourceLineageId: id, outcomeTlp: tlp, observedAt: iso, ingestedAt: iso, adjudicatedAt: iso, adjudicatorId: id, monitoring }).strict(),
  z.object({ kind: z.literal('NO_STEP_VERIFIED'), outcomeTlp: tlp, adjudicatedAt: iso, adjudicatorId: id, monitoring }).strict(),
  z.object({ kind: z.literal('UNKNOWN'), reason: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('CENSORED'), reason: z.string().min(1), monitoring: monitoring.optional() }).strict(),
]);
const validationCase = z.object({
  tenantId: id, runId: id, actorId: id.nullable(), campaignId: id.nullable(), createdById: id,
  asOf: iso, horizonDays: z.number().int().min(1).max(90), maxTlp: tlp,
  status: z.enum(['GENERATED', 'ABSTAINED']), engineVersion: z.literal('deterministic-1'), ruleVersion: z.literal('explicit-transitions-1'),
  inputSnapshot: snapshot, inputDigest: z.string().regex(/^[a-f0-9]{64}$/), candidates: z.array(candidate),
  availability: z.array(availability), catalogAvailability: z.array(catalogAvailability), adjudication,
}).strict();
export const validationDatasetSchema = z.object({
  provenance: z.enum(['REAL_ADJUDICATED', 'SYNTHETIC']), tenantId: id,
  split: z.object({ trainEnd: iso, testStart: iso, testEnd: iso }).strict(),
  cases: z.array(validationCase),
}).strict();
export type ValidationDataset = z.infer<typeof validationDatasetSchema>;
export type ValidationCase = ValidationDataset['cases'][number];
export type Tlp = z.infer<typeof tlp>;
