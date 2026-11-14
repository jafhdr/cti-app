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

export function simulationAllowed(enabled: string | undefined, isolated: string | undefined, database: string): boolean {
  return enabled === 'true' && isolated === 'true' && /^cti_soar_qa_[a-z0-9_]+$/.test(database);
}
