import { createHash } from 'node:crypto';
import { evaluateNextStep } from './next-step.logic';
import { validationDatasetSchema, type ValidationCase, type Tlp } from './next-step-validation.dto';

export const EVALUATOR_VERSION = 'offline-validation-1' as const;
const tlpRank = { CLEAR: 0, GREEN: 1, AMBER: 2, AMBER_STRICT: 3, RED: 4 } as const;
export class ValidationError extends Error { constructor(message: string) { super(message); this.name = 'ValidationError'; } }
const fail = (message: string): never => { throw new ValidationError(message); };
const time = (value: string): number => new Date(value).getTime();
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const stable = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
};

// Phase 2B v1 hashed this exact field order before PostgreSQL JSONB reordered keys.
const legacySnapshot = (snapshot: ValidationCase['inputSnapshot']) => ({
  engineVersion: snapshot.engineVersion, ruleVersion: snapshot.ruleVersion, asOf: snapshot.asOf,
  horizonDays: snapshot.horizonDays, scope: snapshot.scope,
  observations: snapshot.observations.map(row => ({ id: row.id, techniqueId: row.techniqueId, campaignId: row.campaignId,
    sourceLineageId: row.sourceLineageId, externalId: row.externalId, attackVersion: row.attackVersion,
    observedStartAt: row.observedStartAt, observedEndAt: row.observedEndAt, actorConfidence: row.actorConfidence,
    techniqueConfidence: row.techniqueConfidence, status: row.status, tlp: row.tlp })),
  catalog: snapshot.catalog.map(row => ({ id: row.id, externalId: row.externalId, name: row.name, tactic: row.tactic })),
});

function verifyCase(row: ValidationCase): void {
  const scope = row.actorId ?? row.campaignId;
  if (Boolean(row.actorId) === Boolean(row.campaignId) || !scope || row.inputSnapshot.scope !== scope) fail(`Run ${row.runId}: scope mismatch`);
  if (row.inputSnapshot.asOf !== row.asOf || row.inputSnapshot.horizonDays !== row.horizonDays || row.inputSnapshot.engineVersion !== row.engineVersion || row.inputSnapshot.ruleVersion !== row.ruleVersion) fail(`Run ${row.runId}: snapshot contract mismatch`);
  if (digest(JSON.stringify(legacySnapshot(row.inputSnapshot))) !== row.inputDigest) fail(`Run ${row.runId}: input digest mismatch`);
  if (row.inputSnapshot.observations.some(item => tlpRank[item.tlp] > tlpRank[row.maxTlp])) fail(`Run ${row.runId}: TLP classification mismatch`);
  const cutoff = time(row.asOf);
  const availability = new Map(row.availability.map(item => [item.observationId, item]));
  if (availability.size !== row.inputSnapshot.observations.length) fail(`Run ${row.runId}: observation availability mismatch`);
  for (const item of row.inputSnapshot.observations) {
    const fact = availability.get(item.id);
    if (!fact) throw new ValidationError(`Run ${row.runId}: missing observation availability`);
    if (time(fact.createdAt) > cutoff || time(fact.ingestedAt) > cutoff || time(item.observedEndAt) > cutoff || (item.status !== 'CANDIDATE' && (!fact.reviewedAt || time(fact.reviewedAt) > cutoff))) fail(`Run ${row.runId}: future information crossed cutoff`);
  }
  const catalogAvailability = new Map(row.catalogAvailability.map(item => [item.techniqueId, item]));
  if (catalogAvailability.size !== row.inputSnapshot.catalog.length) fail(`Run ${row.runId}: catalog availability mismatch`);
  for (const item of row.inputSnapshot.catalog) {
    const fact = catalogAvailability.get(item.id);
    if (!fact || time(fact.createdAt) > cutoff || time(fact.updatedAt) > cutoff) fail(`Run ${row.runId}: future catalog crossed cutoff`);
  }
  const replay = evaluateNextStep(row.inputSnapshot.observations, row.inputSnapshot.catalog);
  if (replay.status !== row.status || replay.candidates.length !== row.candidates.length) fail(`Run ${row.runId}: frozen rule replay mismatch`);
  for (const [index, candidate] of row.candidates.entries()) {
    const expected = replay.candidates[index];
    if (!expected || candidate.rank !== index + 1 || candidate.techniqueId !== expected.techniqueId || candidate.supportScore !== expected.supportScore || stable(candidate.supportingObservationIds) !== stable(expected.supportingObservationIds) || stable(candidate.contradictingObservationIds) !== stable(expected.contradictingObservationIds) || stable(candidate.ruleTrace) !== stable(expected.ruleTrace)) fail(`Run ${row.runId}: candidate replay mismatch`);
  }
  const label = row.adjudication;
  if (label.kind === 'UNKNOWN' || label.kind === 'CENSORED') return;
  const horizonEnd = cutoff + row.horizonDays * 86400000;
  if (!label.monitoring.complete || time(label.monitoring.startAt) > cutoff || time(label.monitoring.endAt) < horizonEnd) fail(`Run ${row.runId}: complete monitoring coverage required`);
  if (label.adjudicatorId === row.createdById || time(label.adjudicatedAt) <= cutoff) fail(`Run ${row.runId}: independent later adjudicator required`);
  if (label.kind === 'VERIFIED_TECHNIQUE') {
    if (time(label.observedAt) <= cutoff || time(label.observedAt) > horizonEnd || time(label.ingestedAt) <= cutoff || time(label.adjudicatedAt) < time(label.ingestedAt)) fail(`Run ${row.runId}: outcome time outside horizon or availability`);
    if (row.inputSnapshot.observations.some(item => item.sourceLineageId === label.sourceLineageId || item.id === label.observationId)) fail(`Run ${row.runId}: outcome evidence lineage is not independent`);
  }
}

type Rate = { readonly n: number; readonly value: number; readonly lower95: number; readonly upper95: number };
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
function rate(hits: number, count: number): Rate | null {
  if (count === 0) return null;
  const p = hits / count, z = 1.96, denominator = 1 + z * z / count;
  const centre = (p + z * z / (2 * count)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) + z * z / (4 * count)) / count) / denominator;
  return { n: count, value: round(p), lower95: round(Math.max(0, centre - half)), upper95: round(Math.min(1, centre + half)) };
}
const truth = (row: ValidationCase): string | null => row.adjudication.kind === 'VERIFIED_TECHNIQUE' ? row.adjudication.techniqueId : null;
const recent = (row: ValidationCase): readonly string[] => [...row.inputSnapshot.observations].filter(item => item.status === 'CONFIRMED').reverse().map(item => item.techniqueId).filter((value, index, all) => all.indexOf(value) === index).slice(0, 3);

export function evaluateValidation(input: unknown, tenantId: string, clearance: Tlp) {
  const parsed = validationDatasetSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(`Invalid validation dataset: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  const dataset = parsed.data;
  if (dataset.tenantId !== tenantId || dataset.cases.some(row => row.tenantId !== tenantId)) fail('Mixed or mismatched tenant data');
  const { trainEnd, testStart, testEnd } = dataset.split;
  if (!(time(trainEnd) < time(testStart) && time(testStart) < time(testEnd))) fail('Invalid temporal split');
  if (new Set(dataset.cases.map(row => row.runId)).size !== dataset.cases.length) fail('Duplicate run ID');
  const visible = dataset.cases.filter(row => tlpRank[row.maxTlp] <= tlpRank[clearance] && (row.adjudication.kind === 'UNKNOWN' || row.adjudication.kind === 'CENSORED' || tlpRank[row.adjudication.outcomeTlp] <= tlpRank[clearance]));
  visible.forEach(verifyCase);
  const training = visible.filter(row => time(row.asOf) < time(trainEnd) && row.adjudication.kind === 'VERIFIED_TECHNIQUE' && time(row.adjudication.adjudicatedAt) <= time(trainEnd));
  const trainCampaigns = new Set(training.map(row => row.campaignId).filter((value): value is string => Boolean(value)));
  const trainLineages = new Set(training.flatMap(row => row.inputSnapshot.observations.map(item => item.sourceLineageId)));
  const window = visible.filter(row => time(row.asOf) >= time(testStart) && time(row.asOf) < time(testEnd));
  const test = window.filter(row => !((row.campaignId && trainCampaigns.has(row.campaignId)) || row.inputSnapshot.observations.some(item => trainLineages.has(item.sourceLineageId))));
  const frequency = new Map<string, number>();
  for (const row of training) { const technique = truth(row); if (technique) frequency.set(technique, (frequency.get(technique) ?? 0) + 1); }
  const common = [...frequency].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([id]) => id);
  const evaluable = test.filter(row => row.adjudication.kind === 'VERIFIED_TECHNIQUE' || row.adjudication.kind === 'NO_STEP_VERIFIED');
  const engineRanks = evaluable.map(row => row.candidates.map(item => item.techniqueId));
  const top1Hits = evaluable.filter((row, index) => Boolean(truth(row) && engineRanks[index]?.[0] === truth(row))).length;
  const top3Hits = evaluable.filter((row, index) => Boolean(truth(row) && engineRanks[index]?.slice(0, 3).includes(truth(row) ?? ''))).length;
  const falseHypotheses = evaluable.reduce((count, row, index) => count + (engineRanks[index]?.filter(id => id !== truth(row)).length ?? 0), 0);
  const leadTimeHours = evaluable.flatMap(row => {
    const label = row.adjudication;
    return label.kind === 'VERIFIED_TECHNIQUE' && row.candidates.some(item => item.techniqueId === label.techniqueId) ? [round((time(label.observedAt) - time(row.asOf)) / 3600000)] : [];
  });
  const baseline = (ranking: (row: ValidationCase) => readonly string[]) => ({ eligible: evaluable.length, top1Hits: evaluable.filter(row => Boolean(truth(row) && ranking(row)[0] === truth(row))).length, top3Hits: evaluable.filter(row => Boolean(truth(row) && ranking(row).slice(0, 3).includes(truth(row) ?? ''))).length });
  const counts = { testRuns: test.length, evaluable: evaluable.length, generated: test.filter(row => row.status === 'GENERATED').length, abstained: test.filter(row => row.status === 'ABSTAINED').length, unknown: test.filter(row => row.adjudication.kind === 'UNKNOWN').length, censored: test.filter(row => row.adjudication.kind === 'CENSORED').length, top1Hits, top3Hits, falseHypotheses, tlpExcluded: dataset.cases.length - visible.length, groupLeakExcluded: window.length - test.length, trainingOutcomes: training.length };
  return { evaluatorVersion: EVALUATOR_VERSION, verdict: dataset.provenance === 'SYNTHETIC' ? 'SYNTHETIC_CORRECTNESS_ONLY' : evaluable.length === 0 ? 'NOT_EVALUABLE' : 'DESCRIPTIVE_VALIDATION_ONLY', provenance: dataset.provenance, tenantId, split: dataset.split, counts,
    metrics: { top1: rate(top1Hits, evaluable.length), top3: rate(top3Hits, evaluable.length), coverage: rate(counts.generated, test.length), abstention: rate(counts.abstained, test.length), falseHypothesesPerEvaluableRun: evaluable.length ? round(falseHypotheses / evaluable.length) : null },
    baselines: { recentTechnique: baseline(recent), commonTrainingOutcome: common.length ? baseline(() => common) : null }, leadTimeHours,
    audit: { inputDigest: digest(stable(dataset)), selectionDigest: digest(stable({ tenantId, clearance, split: dataset.split, evaluatorVersion: EVALUATOR_VERSION })), caseRunIds: test.map(row => row.runId).sort() } } as const;
}
