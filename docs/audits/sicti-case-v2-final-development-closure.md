# SICTI Case Management V2 — final development closure review

Date: 31 October 2026 (Asia/Jakarta). **Verdict: CASE MANAGEMENT V2 DEVELOPMENT CLOSED WITH DOCUMENTED LIMITATIONS.** P1-A through P1-D passed isolated phase acceptance. The shared audit-event blocker from the first closure review was corrected and accepted separately in `sicti-case-v2-audit-event-contract-remediation.md`. This verification changed no application functionality and does not declare production readiness.

## Acceptance and integration matrix

| Slice | Implemented capability | Isolated acceptance | Final review |
|---|---|---|---|
| P1-A | Five origins, immutable provenance, idempotent creation, ASM/AppSec reuse, legacy unknown projection, V1 compatibility | Phase report and authenticated QA PASS | Closed with audit-event remediation |
| P1-B | Tasks, handoff, UTC due date, revision conflicts, workflow UI | 59 authenticated checks and three browser widths PASS | Closed with audit-event remediation |
| P1-C | Metadata revisions, independent reviewer, approved closure, reopening and immutable revision/review/closure rows | 91 authenticated checks and browser workflow PASS | Closed with audit-event remediation |
| P1-D | Tenant scoped summary/queue, analyst/task workload, overdue, aging, origin and review metrics, dashboard | 27 authenticated checks, 500-Case timing, three browser widths PASS | Closed; read-only reporting confirmed |

The four phase reports are `sicti-case-v2-p1{a,b,c,d}-implementation-and-acceptance.md` in this directory. The audit remediation was accepted on new disposable PostgreSQL `cti_case_v2_audit_qa_20261031`: authenticated P1-A/B/C/D suites passed together, including V1 scenarios, rollback checks, concurrency and idempotent retries. Backend Jest passed 205 tests in 23 suites; focused V1 Case tests passed 15/15. This final verification repeated Prisma validation, migration status, backend build, frontend typecheck, and the focused audit-contract assertion; all passed. Previously accepted browser workflows were reused because no UI changed. `prisma migrate status` reports **76 migrations** and schema up to date in the disposable database. The six Case migrations are uniquely ordered after the approved `5d06bfc` baseline. They add tables/columns/indexes/triggers; the P1-A corrective migration replaces one CaseCreateRequest FK with CASCADE for legacy reuse, without dropping data. `git diff --check` passed. Fresh case8 QA command output remains in `.omo/evidence/final-qa/case8-readonly-checks.txt`; this verification's commands and results are recorded here and in the remediation report.

Previous real Chrome captures show authenticated P1-A/B/C workflows and the P1-D dashboard at 1280, 768 and 375 px. The P1-D report links its screenshots and records case-detail navigation without page overflow. Backend route decorators, shared tenant scopes and module catalog keys are present for all four slices. P1-C QA verified assigned independent reviewer decisions, denied self-review, closure preconditions, two-cycle reopening history, and unchanged TI Indicator, ASM Alert and AppSec Finding lifecycle states. P1-D aggregate and queue queries bind tenant identifiers and use a repeatable-read PostgreSQL transaction that executes `SET TRANSACTION READ ONLY`; separate summary and queue requests still have separate snapshots. The P1-C persisted fixture reconciled to three approvals, one rejection, one reopen and two investigation cycles. The local 500-Case P1-D run measured 24–26 ms warm summary and 13 ms bounded queue, without establishing production capacity.

## Resolved audit-event blocker and security

The approved [Phase 1 architecture contract](../../../docs/audits/sicti-case-v2-phase1-architecture-contract.md) requires request identity, event-time Case revision, tenant, Case, actor, action, server timestamp and applicable state changes in paired transactional CaseActivity/AuditLog records. `backend/src/cases/case-v2-audit.ts` now writes those values together; migration `20261102150000_case_v2_audit_contract` prevents ordinary SQL UPDATE/DELETE of the ten named V2 action types without changing V1 event deletion. The accepted PostgreSQL check inspected **all 32 newly generated V2 events** across origin, tasks, handoff, due date, evidence, reviews, closure and reopen. Every event had a UUID request ID and Case revision, exactly one matching AuditLog row, and matching actor, action, tenant, Case and timestamp. Handoff and review-decision revisions matched persisted business rows; closure/reopen transitions matched the workflow. Both V2 tables rejected SQL UPDATE/DELETE. Existing metadata-less V2 rows remained incomplete rather than receiving fabricated IDs or revisions, and the new trigger protected them. P1-A/B/C rollback, revision-conflict, independent-review, immutable-history and idempotency scenarios passed on the same disposable database.

Authentication and Case Management feature gates remain on the V2 routes; tenant predicates, explicit SUPER_ADMIN tenant context and independent reviewer separation were verified by the phase and remediation HTTP suites. V1 Case routes remained compatible, and TI Indicator, ASM Alert and AppSec Finding lifecycle rows were not silently changed. P1-D summary/queue use parameterized tenant-scoped reads in repeatable-read transactions with `SET TRANSACTION READ ONLY`. No unresolved approved development-contract blocker remains.

## Limitations and rollout boundaries

| Item from case8.md | Classification | Boundary |
|---|---|---|
| 1. Active flags/entitlements disabled | Production rollout prerequisite | Four V2 flags and five feature catalog keys remain inactive/unassigned outside QA. The active backend `.env` contains no V2 enable flag. |
| 2. Active `cti` database unmigrated | Production rollout prerequisite | Only disposable databases received 76 migrations. A read-only query found zero completed Case V2 migrations in `cti`. |
| 3. Incomplete legacy origin/evidence/due/resolution data | Documented limitation | Reporting labels unknown/missing data rather than backfilling it. |
| 4. Metadata-only evidence integrity | Documented limitation | No uploaded file-byte digest is claimed. |
| 5. Retention, legal hold, deletion/export policy | Production rollout prerequisite | Owner governance decision required before active-data activation. |
| 6. SLA policy engine and breach notifications absent | Documented limitation | Due dates and current overdue counts exist; no historical SLA rate is fabricated. |
| 7. 500-Case performance test | Documented limitation | Local timing is not production capacity validation. |
| 8. V1 assignment lacks V2 handoff row | Documented limitation | V1 contract retained; reasoned V2 handoff has its own path. |
| 9. No dedicated P1-A origin creation UI | Documented rollout limitation requiring owner acceptance | Backend API is present and default off. The architecture allows frontend use after activation, but explicit owner acceptance of a backend-only initial rollout was not found. |
| 10. ASM V2 limitations | Separate documented limitations | Case V2 does not resolve ASM V2 rollout or correlation limits. |

The architecture contract leaves SUPER_ADMIN override scope to an owner decision. Existing module access policy grants SUPER_ADMIN globally after explicit tenant selection; the V2 services follow that convention. Tenant-scoped flags, catalog entitlements and the exact privileged rollout policy must be approved before activation. This is a **rollout prerequisite**, not proof of a foreign-tenant data leak in the tested routes.

## Git and next checkpoint

The Case worktree is detached at exactly `5d06bfcd66f9d7831a65f8d701db31c343bdeff1`, with all P1-A/B/C/D and audit remediation migrations, source, QA scripts, reports and browser images present. Many new files are untracked; plain `git diff` and `git commit -a` would omit them. The original dirty `main` remains a separate worktree at `4877dde`, and other worktrees remain listed; this verification made no Git or application changes there. A historical before/after hash of that dirty workspace was not retained, so preservation is supported by worktree separation and the phase records rather than a full independent file comparison.

For a future owner-approved checkpoint, create a dedicated branch from `5d06bfc`. Stage an explicit reviewed allowlist including untracked files, inspect the staged diff and all 76 migrations, and integrate with the chosen target only after a migration collision review. Active database migration, entitlements, flags, Git integration, retention policy, privileged SUPER_ADMIN rollout policy and production readiness remain separate approval gates. **No commit, push, merge, rebase or deployment occurred.**
