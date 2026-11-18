# PR #7 Phase 1 atomicity diff review

**Date:** 2026-11-16 (Asia/Jakarta)\
**Base:** `797cbb9669c24b9f9cfbf70c93e04cfa90f9d8a6`; uncommitted Phase 1 diff only\
**Verdict: NEEDS CORRECTION**

The production change fixes the **same-finding orphan Case race** in the reviewed path. `monitoring-links.service.ts:35-56` acquires a parameterized, tenant-scoped PostgreSQL `FOR UPDATE` row lock inside the Prisma interactive transaction, re-reads the finding after acquiring it, and passes that transaction client into `CasesService.create()`. Case insertion, Case activity/`CASE_CREATED` audit, finding association, and `MONITORING_CASE_LINKED` audit use the same transaction and roll back together (`cases.service.ts:498-545`). Repeated requests return the linked Case; a different requested Case conflicts. The controller's ADMIN/SUPER_ADMIN and module guards, target-tenant Case entitlement, and foreign Case lookup remain in place. Existing two-argument `CasesService.create()` callers retain their internal transaction behavior. The tagged SQL query is parameterized; no migration, unrelated application module, or security guard was changed.

## Corrections before Phase 1 approval

| Priority | Finding | Required correction |
| --- | --- | --- |
| **Medium — acceptance evidence** | The PostgreSQL-backed test uses two real authenticated HTTP requests and checks one Case, one finding link, and audit counts, but `monitoring-case-concurrency.integration.spec.cjs:77-79` accepts either 201 or 409 and does not compare both response IDs. Thus it would pass if a request conflicts instead of returning the existing Case, while `sicti-pr7-monitoring-case-atomicity-fix.md` claims both returned the same Case. | Assert both responses are 201 and both body IDs equal the single persisted finding Case ID. Add an explicit unchanged `MONITORING_CASE_LINKED` count in the forced-rollback portion (`spec.cjs:94-102`). |
| **Medium — reproducibility** | The test delays the first `CasesService.create()` by 250 ms (`spec.cjs:70-75`); it does not prove the second request reached the contested path before the first committed. The Phase 1 report contains only a narrative of red/green/build output, with no durable raw log artifact. | Use an explicit coordination hook/barrier to prove overlapping requests while remaining compatible with the locked path, and retain sanitized red/green and build output tied to this diff. |

## Separate Case-number allocator risk

`CasesService.generateCaseNumber()` derives a tenant-wide number from `case.count() + 1` (`cases.service.ts:41-49`). The new row lock covers **one Monitoring finding**, not two different findings in the same tenant. Their concurrent Case creates can still choose the same number; the Case unique constraint rejects one and its request can surface an internal error. This allocator predates Phase 1 and does **not** recreate an orphan Case: the failed transaction rolls back its Case and finding link. It does affect the reliability of concurrent creates for different findings and should receive a concurrency-safe allocator or bounded unique-conflict retry before broader rollout. Keep that remediation distinct from the confirmed same-finding atomicity fix.

Prisma v6's interactive transaction default timeout is 5 seconds. A follower waiting longer on the row lock can fail and roll back without orphaning a Case; the current 250 ms test does not cover that bound. Define and test the timeout/retry response contract if contention at that duration is in scope for Phase 1 acceptance. No deadlock cycle was identified in the single-row, lock-first path reviewed here.

The prior Phase 1 report records a failing-first PostgreSQL run (`2 !== 1`), then a passing run with one Case and one link, rollback assertions, 11/11 focused HTTP/Case tests, 10/10 unit tests, and a backend build. Those results were **not rerun** during this read-only diff review, and raw run logs are not attached to that report. The review therefore accepts the transaction design but cannot approve the stated idempotent-response and reproducibility claims yet.

**Next action:** tighten the regression assertions and durable evidence, then resolve or explicitly gate the separate tenant-wide Case-number collision. Re-review Phase 1 before starting Phase 2 Correlation Alert–Case API integration. No code, test, migration, database, commit, PR state, or other worktree was changed in this review.
