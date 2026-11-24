# PR #7 Monitoring–Case atomicity remediation

**Date:** 2026-11-16 (Asia/Jakarta)\
**Base commit:** `797cbb9669c24b9f9cfbf70c93e04cfa90f9d8a6`\
**Verdict: PHASE 1 ACCEPTANCE PASS** for the scoped Monitoring finding → Case race. PR #7 remains unchanged and draft.

## Root cause and change

`MonitoringLinksService.case()` previously called `CasesService.create()` before beginning the finding-link transaction. Two requests could both observe `caseId: null`, each commit a Case, and only one win the conditional link update. The losing Case remained in PostgreSQL.

The new path acquires a parameterized PostgreSQL `FOR UPDATE` lock on the tenant's finding row inside one Prisma interactive transaction. It rechecks the finding's confirmed/retention state after acquiring the lock, then creates the Case through the existing `CasesService.create()` validation and audit path **using that same transaction**. The finding update and `MONITORING_CASE_LINKED` audit commit with Case creation or roll back together. A second request waits for the lock, sees the linked Case, and returns it; an explicitly different `caseId` still conflicts. Existing tenant, module, role, and foreign-Case checks remain in place.

Changed files:

- `backend/src/intelligence/monitoring-links.service.ts` — row lock, post-lock state check, single transaction, existing-result idempotency.
- `backend/src/cases/cases.service.ts` — optional caller-supplied Prisma transaction for the existing validated Case creation path; ordinary callers still create through an internal transaction.
- `backend/src/intelligence/monitoring-case-concurrency.integration.spec.cjs` — authenticated PostgreSQL HTTP regression, negative permissions/tenant paths, repeat request, audit counts, and induced rollback.

No migration, security guard, unrelated module, or frontend component changed.

## Evidence

The disposable QA database received all **91 existing migrations**. The test sent two authenticated `POST /intelligence/monitoring/findings/:id/case` requests against one confirmed finding. A QA-only hook paused the first request after its finding row lock was acquired. The test then started the second request and queried `pg_stat_activity` until PostgreSQL reported that request waiting on a lock for `MonitoringFinding ... FOR UPDATE`. It released the first request only after observing that overlap. The coordination does not require both callers to hold the exclusive lock or rely on a fixed delay.

| Check | Observed result |
| --- | --- |
| Failing-first test on original code | **FAIL**: `no orphan Case may commit`, `2 !== 1`, observed in the preceding Phase 1 session on actual PostgreSQL/Nest HTTP. That earlier output was not retained as a raw file; it is not presented as a new Phase 1B raw log. The current deterministic test depends on the row lock and therefore was not run against the pre-fix implementation. |
| Same test after fix | **PASS**: `overlapObserved=true`; both responses 201; response Case IDs equal each other and the one persisted finding Case ID; one Case row, one `CASE_CREATED`, and one `MONITORING_CASE_LINKED` audit. [Concurrency log](sicti-pr7-atomicity-concurrency-log.txt). |
| Repeat request | 201 with the already linked Case ID; no new Case or audit. |
| Forced failure after Case insertion | Synthetic caller received 500; second finding remained unlinked; Case count and both `CASE_CREATED` and `MONITORING_CASE_LINKED` audit counts stayed at one from the prior committed operation. [Focused log](sicti-pr7-atomicity-focused-test-log.txt). |
| Cross-tenant/authorization | Foreign finding 404, foreign Case ID 404, reader 403, unauthenticated 401; no own-tenant Case created by these requests. [Focused log](sicti-pr7-atomicity-focused-test-log.txt). |
| Focused tests | `node --test src/intelligence/monitoring-case-concurrency.integration.spec.cjs src/cases/cases.from-indicator.spec.cjs`: **11/11 PASS**. `npm test -- --runInBand --silent src/intelligence/monitoring.logic.spec.ts src/cases/cases.assignment.spec.ts`: **2/2 suites, 10/10 tests PASS**. [HTTP/Case log](sicti-pr7-atomicity-focused-test-log.txt), [unit log](sicti-pr7-atomicity-unit-log.txt). |
| Compilation and migration | `prisma migrate deploy`: 91/91 existing migrations applied; `npm run build` in `backend`: exit 0; `git diff --check`: PASS. [Migration log](sicti-pr7-atomicity-migration-log.txt), [build log](sicti-pr7-atomicity-build-log.txt). |

One earlier Phase 1 test run failed because the synthetic foreign Case fixture used a nonexistent `createdBy` ID; that fixture was corrected to use its actual foreign user. In Phase 1B, the initial run stopped at the test's QA database-name assertion because the new disposable database was named `sict38…`; the same database was renamed to the allowed `sict36…` pattern before the successful run. Neither setup failure indicates an application regression. The final focused runs above passed. No broad E2E matrix was repeated.

## Scope and remaining risk

The row lock serializes **Case linking for the same finding** at PostgreSQL's default read-committed transaction behavior. Independent Case creation elsewhere still uses the existing tenant-wide `count() + 1` Case number allocator. Two different findings may concurrently choose the same number; the unique constraint can reject one transaction and return an error, though it does not commit an orphan Case. **Release gate:** before PR #7 merge or broader rollout, implement a concurrency-safe per-tenant/year allocator or bounded unique-conflict retry and test simultaneous creation for different findings. This allocator is not redesigned in Phase 1B. Prisma's default 5-second interactive transaction timeout can still cancel a prolonged lock waiter; rollback preserves data integrity, while the request-level timeout contract remains to be validated for high contention. The direct Correlation Alert → Case API, CI gate, latest QA evidence attachment, and PR security/merge decisions identified in the prior review remain separate work.

**Next required action:** review the tightened Phase 1 evidence, then proceed to Phase 2 Correlation Alert–Case API integration while keeping the allocator release gate open. Do not change PR #7's draft status until the remaining merge gates are met.
