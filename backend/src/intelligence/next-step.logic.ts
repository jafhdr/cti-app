export const ENGINE_VERSION = 'deterministic-1' as const;
export const RULE_VERSION = 'explicit-transitions-1' as const;

export type HypothesisInput = {
  readonly id: string;
  readonly techniqueId: string;
  readonly campaignId: string | null;
  readonly sourceLineageId: string;
  readonly externalId: string;
  readonly attackVersion: string;
  readonly observedStartAt: string;
  readonly observedEndAt: string;
  readonly actorConfidence: number | null;
  readonly techniqueConfidence: number;
  readonly status: 'CANDIDATE' | 'CONFIRMED' | 'DISPUTED' | 'REJECTED';
  readonly tlp: 'CLEAR' | 'GREEN' | 'AMBER' | 'AMBER_STRICT' | 'RED';
};
export type TechniqueOption = { readonly id: string; readonly externalId: string; readonly name: string; readonly tactic: string };
type TransitionRule = { readonly id: string; readonly from: string; readonly to: string; readonly explanation: string; readonly steps: readonly string[] };

// These analyst-authored possibilities are investigation prompts, never observed ATT&CK progression edges.
export const TRANSITION_RULES: readonly TransitionRule[] = [
  { id: 'command-to-transfer', from: 'T1059', to: 'T1105', explanation: 'After observed command execution, investigate whether tools were transferred into the environment.', steps: ['Review network and proxy logs for inbound tool retrieval.', 'Check endpoint process and file creation telemetry for transferred payloads.'] },
  { id: 'transfer-to-remote-services', from: 'T1105', to: 'T1021', explanation: 'After observed tool transfer, investigate possible remote service use; this is not inferred lateral movement.', steps: ['Review remote authentication and service logons.', 'Compare host-to-host connections with known administration activity.'] },
] as const;

export type HypothesisCandidate = {
  readonly techniqueId: string;
  readonly externalId: string;
  readonly name: string;
  readonly tactic: string;
  readonly supportScore: number;
  readonly supportingObservationIds: readonly string[];
  readonly contradictingObservationIds: readonly string[];
  readonly ruleTrace: { readonly ruleVersion: typeof RULE_VERSION; readonly ruleId: string; readonly explanation: string; readonly components: { readonly base: number; readonly attribution: number; readonly techniqueMapping: number; readonly corroboration: number; readonly contradiction: number; readonly priorObservation: number } };
  readonly investigationSteps: readonly string[];
};
export type HypothesisResult = { readonly status: 'GENERATED' | 'ABSTAINED'; readonly abstentionReason: string | null; readonly candidates: readonly HypothesisCandidate[] };
const abstain = (reason: string): HypothesisResult => ({ status: 'ABSTAINED', abstentionReason: reason, candidates: [] });

export function evaluateNextStep(inputs: readonly HypothesisInput[], catalog: readonly TechniqueOption[]): HypothesisResult {
  const observations = [...inputs].sort((a, b) => a.observedStartAt.localeCompare(b.observedStartAt) || a.observedEndAt.localeCompare(b.observedEndAt) || a.id.localeCompare(b.id));
  const confirmed = observations.filter(row => row.status === 'CONFIRMED');
  if (confirmed.length < 2) return abstain('At least two confirmed source-backed observations are required.');
  const [earlier, latest] = confirmed.slice(-2);
  if (!earlier || !latest) return abstain('At least two confirmed observations are required.');
  if (observations.some(row => row.status === 'DISPUTED' && (row.externalId === earlier.externalId || row.externalId === latest.externalId))) return abstain('Disputed input-chain evidence requires analyst resolution.');
  if (earlier.observedEndAt >= latest.observedStartAt) return abstain('Observation intervals overlap; their order is uncertain.');
  if (earlier.campaignId !== latest.campaignId) return abstain('The latest observations belong to different campaign contexts.');
  if (confirmed.some(row => row.actorConfidence === null || row.actorConfidence < 60 || row.techniqueConfidence < 60)) return abstain('Attribution or technique mapping confidence is insufficient.');
  if (earlier.sourceLineageId === latest.sourceLineageId) return abstain('Independent source lineages are required for corroboration.');
  if (new Set(confirmed.map(row => row.attackVersion)).size !== 1) return abstain('ATT&CK catalog versions conflict.');

  const candidates = TRANSITION_RULES.filter(rule => rule.from === latest.externalId).flatMap(rule => {
    const technique = catalog.find(item => item.externalId === rule.to);
    if (!technique) return [];
    const contradictory = observations.filter(row => row.externalId === rule.to && row.status === 'DISPUTED').map(row => row.id);
    const priorObserved = confirmed.some(row => row.externalId === rule.to);
    const components = { base: 30, attribution: Math.floor((latest.actorConfidence ?? 0) / 5), techniqueMapping: Math.floor(latest.techniqueConfidence / 5), corroboration: 10, contradiction: contradictory.length ? -30 : 0, priorObservation: priorObserved ? -20 : 0 };
    return [{ techniqueId: technique.id, externalId: technique.externalId, name: technique.name, tactic: technique.tactic,
      supportScore: Math.max(0, Math.min(100, Object.values(components).reduce((sum, value) => sum + value, 0))),
      supportingObservationIds: [earlier.id, latest.id], contradictingObservationIds: contradictory,
      ruleTrace: { ruleVersion: RULE_VERSION, ruleId: rule.id, explanation: rule.explanation, components }, investigationSteps: rule.steps }];
  }).sort((a, b) => b.supportScore - a.supportScore || a.externalId.localeCompare(b.externalId));
  return candidates.length ? { status: 'GENERATED', abstentionReason: null, candidates } : abstain('No explicit transition rule has a matching tenant ATT&CK technique.');
}
