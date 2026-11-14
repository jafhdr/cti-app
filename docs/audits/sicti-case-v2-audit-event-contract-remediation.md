# SICTI Case V2 audit-event contract remediation

Date: 31 October 2026 (Asia/Jakarta). **Verdict: CASE V2 AUDIT-EVENT CONTRACT REMEDIATION PASS.** This resolves the specific development closure blocker recorded in `sicti-case-v2-final-development-closure.md`; it does not independently close Case Management V2 development or authorize rollout.

## Root cause and correction

The P1-A origin path and P1-B/P1-C event helpers wrote CaseActivity and AuditLog metadata without a request ID or the Case revision at the time of the event. Existing CaseActivity/AuditLog tables also allowed SQL UPDATE/DELETE of V2 rows. The failure was reproduced first: the audit QA assertion failed on `CASE_V2_ORIGIN_CREATED lacks requestId` in the previous disposable P1-D database.

`backend/src/cases/case-v2-audit.ts` now writes the paired event and audit record inside the caller's existing transaction. It reads the persisted tenant-scoped Case revision and database clock, generates a fresh server-side UUID request ID, and writes identical request ID, revision, case ID, tenant ID, actor, action and timestamp to both records. P1-A, P1-B and P1-C call this helper. Specific metadata retains origin/source, task, assignee, due-date, evidence, review and cycle context. State transitions include previous/new values where applicable. Evidence's own revision is explicitly named `fromEvidenceRevision`/`toEvidenceRevision` so `revision` unambiguously means **Case revision**. The idempotency key remains a separate concept.

The additive migration `backend/prisma/migrations/20261102150000_case_v2_audit_contract/migration.sql` adds UPDATE/DELETE rejection triggers on CaseActivity and AuditLog **only** for the ten V2 action names. It changes no existing rows and adds no nullable/backfilled fake metadata. V1 Case activity and unrelated audit consumers retain their existing SQL and delete behavior. Existing V2 events without request ID/revision remain historically incomplete but become protected from subsequent UPDATE/DELETE.

## Isolated PostgreSQL and HTTP acceptance

The new disposable database `cti_case_v2_audit_qa_20261031` received **76/76** ordered migrations and the synthetic seed. Its `DATABASE_URL` was used for the existing authenticated P1-A, P1-B, P1-C and P1-D HTTP suites. Results: P1-A PASS (including concurrent idempotency and V1 compatibility), P1-B PASS (59 checks), P1-C PASS (91 checks, independent review and failed-write rollback), P1-D PASS (27 checks). Their printed database names are hardcoded phase labels; the shell URL selected the new audit QA database.

`backend/qa-case-v2-audit-contract.cjs` inspected **all 32 newly generated V2 CaseActivity rows** across origin (11), task create/update (2/4), handoff (1), due-date change (2), evidence revision (1), review request/decision (4/4), closure (2), and reopen (1). Each had a UUID request ID, nonnegative Case revision no greater than current persisted revision, matching tenant/case/actor/action, and exactly one AuditLog row with the same request ID, revision and timestamp. V2 activity and audit totals matched. Origin events recorded revision 0; handoff and review-decision revisions matched their persisted business rows. Closure/reopen state transitions matched the persisted workflow. SQL UPDATE/DELETE of both V2 activity and audit rows was rejected. The script also proved that a V1 activity/audit row can still be updated and that deleting its legacy Case cascades as before.

The old disposable P1-D database, which already held metadata-less V2 events, received only the new migration (76/76 up to date). `qa-case-v2-audit-legacy.cjs` confirmed an old event still has no invented request ID/revision and that its UPDATE/DELETE now fail. P1-A's induced origin-write failure and P1-C's induced review-decision failure retained their existing transaction rollback assertions. P1-A parallel retries and P1-B revision conflict checks passed again, with no duplicate creation events.

Prisma schema validation and backend build passed. Backend Jest: **23/23 suites, 205/205 tests PASS**. Focused V1 Case Node tests: **15/15 PASS**. Frontend typecheck passed; no UI source changed, so the previously accepted authenticated desktop/tablet/mobile browser evidence remains applicable. `git diff --check` passed. The active `cti` database, original dirty workspace, active feature flags, TI/ASM/AppSec lifecycle data and other worktrees were not changed. No commit, push, merge or deployment occurred.

## Limits and next gate

The triggers protect the named V2 event actions from ordinary SQL UPDATE/DELETE, including historical V2 rows. They do not provide legal hold, protection against a privileged database operator disabling triggers, backup immutability, tenant deletion/export policy, or a retention schedule. The V2 origin and history foreign keys already restrict some Case/tenant deletes; a governance policy is still needed before rollout. Old V2 events remain visibly incomplete and must not be presented as if request identity or event-time revision can be reconstructed.

Recommend **resuming the separate final Case Management V2 development closure review** against this remediation and the retained P1-A/B/C/D acceptance evidence. Keep Git integration, active database migration, flag/entitlement activation and production readiness as separate decisions.
