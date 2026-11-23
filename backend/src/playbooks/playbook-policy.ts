import { qaRuntimeAllowed } from '../qa-runtime-policy';

export const PLAYBOOK_KEY = 'malicious-domain-block-simulation' as const;
export const PLAYBOOK_VERSION = 1 as const;
export const PLAYBOOK_TIMEOUT_MS = 30_000 as const;
export const PLAYBOOK_MAX_ATTEMPTS = 2 as const;

export type State = 'PENDING_CONFIRMATION' | 'PENDING_APPROVAL' | 'APPROVED' | 'EXECUTING' | 'VERIFYING' | 'VERIFIED' | 'FAILED' | 'REJECTED' | 'EXPIRED';
type Event = 'CONFIRM' | 'APPROVE' | 'REJECT' | 'EXECUTE' | 'EXECUTION_SUCCEEDED' | 'EXECUTION_FAILED' | 'VERIFY' | 'TIMEOUT' | 'RETRY';

const transitions: Readonly<Partial<Record<State, Readonly<Partial<Record<Event, State>>>>>> = {
  PENDING_CONFIRMATION: { CONFIRM: 'PENDING_APPROVAL', REJECT: 'REJECTED', TIMEOUT: 'EXPIRED' },
  PENDING_APPROVAL: { APPROVE: 'APPROVED', REJECT: 'REJECTED', TIMEOUT: 'EXPIRED' },
  APPROVED: { EXECUTE: 'EXECUTING', TIMEOUT: 'EXPIRED' },
  EXECUTING: { EXECUTION_SUCCEEDED: 'VERIFYING', EXECUTION_FAILED: 'FAILED', TIMEOUT: 'FAILED' },
  VERIFYING: { VERIFY: 'VERIFIED', TIMEOUT: 'FAILED' },
  FAILED: { RETRY: 'APPROVED' },
} as const;

export class PlaybookTransitionError extends Error {
  constructor(state: State, event: Event) { super(`Cannot apply ${event} to ${state}`); this.name = 'PlaybookTransitionError'; }
}

export function nextPlaybookState(state: State, event: Event): State {
  const next = transitions[state]?.[event];
  if (!next) throw new PlaybookTransitionError(state, event);
  return next;
}

type SimulationPolicyInput = {
  readonly enabled: string | undefined;
  readonly isolatedQa: string | undefined;
  readonly unifiedQa: string | undefined;
  readonly database: string;
};

export function simulationAllowed(input: SimulationPolicyInput): boolean {
  return qaRuntimeAllowed({ module: 'soar', database: input.database,
    featureEnabled: input.enabled, isolatedQa: input.isolatedQa, unifiedQa: input.unifiedQa });
}
