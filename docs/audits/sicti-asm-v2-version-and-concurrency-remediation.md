# SICTI PR #6: ASM V2 version and concurrency remediation

**Task:** `case20.md`
**Branch:** `integration/sicti-v2-frontend-reconciliation`
**Starting head:** `41910d7d20a3a030188a74f4691e4423433d4745`
**Verdict:** ASM V2 VERSION & CONCURRENCY REMEDIATION PASS — PR #6 UPDATED FOR FINAL REVIEW

## Root causes and corrections

1. The SSH banner parser converted OpenSSH portable patch `p1` to `.1`. The matcher then treated `8.4p1` as an unrelated numeric version. The parser now retains `pN`. Exact OpenSSH patch releases compare exactly; base and patch boundaries compare conservatively. An unsupported or ambiguous comparison remains a MEDIUM candidate and cannot authorize automatic retirement. A proven out-of-range result returns no match. Numeric comparison for other products remains unchanged.
2. The discovery writer used TCP `lastSeenAt` as its update guard, while finalization could use a stale service object. A late result from an older run could overwrite a newer fingerprint and reverse a correlation decision. Fingerprint publication and both MATCHED and NOT_OBSERVED transitions now take the same tenant/service advisory transaction lock. The latest persisted observation, ordered by observation time, run start, and observation ID, must be the run's own observation. The current service is read under the lock and rechecked against that observation. An older observation remains in history but cannot overwrite the service or change correlation lifecycle.

No schema change was needed; the existing fingerprint observation record is the durable order source. The existing 77 migrations replayed on a fresh disposable PostgreSQL database. The active `cti` database was not migrated.

## QA evidence

- Jest ASM unit suite: 15 suites, 167 tests passed, including SSH probe, version matching, and V2 retirement.
- Fresh PostgreSQL plus controllable local SSH server: two integration tests passed. A verified `8.4p1` fingerprint keeps an exact match and an ambiguous `8.4` upper-bound correlation active. Verified `9.9p1` retires both, resolves the generated correlation finding, and records NOT_OBSERVED. The reverse `8.4p1` observation restores the exact match.
- Deterministic barriers held A's real `8.4p1` probe while B observed and published `9.9p1`; A finalized afterward without overwriting the service or adding a lifecycle observation. Reversed ordering held an earlier `9.9p1` probe while the later `8.4p1` run published; the earlier probe was ignored. Equal observation timestamps use run start and ID as stable tie breakers. Concurrent matching runs did not add revisions or duplicate lifecycle observations.
- The existing real database regression passed for partial and failed runs, publication rollback, tenant isolation, idempotent retirement, reviewer decision history, and Case/alert, TI, and AppSec preservation. V1 correlation compatibility remained intact.
- `npx prisma validate`, `npm run build`, and `git diff --check` passed. No production flags, deployments, or merges were performed.

This remediation resolves the two code blockers in the prior PR #6 review. PR review, CI, and owner merge approval remain separate gates.
