# PR #7 Phase 3 — concurrency-safe Case numbers

**Date:** 2026-11-16 (Asia/Jakarta)\
**Base commit:** `797cbb9669c24b9f9cfbf70c93e04cfa90f9d8a6`\
**Verdict: CASE ALLOCATOR FIX PASS** for the focused PostgreSQL and HTTP scenarios. PR #7 remains Draft and unchanged.

## Baseline and root cause

The legacy `CasesService.generateCaseNumber()` used the tenant's total Case count plus one. Two authenticated `POST /cases` requests deliberately overlapped after reading the number. On the unmodified allocator, one returned `201 CASE-2026-00001` and the other returned **500**; only one Case committed. The unique `(tenantId, caseNumber)` constraint rejected the collision. [Sanitized failing baseline](sicti-pr7-case-allocator-baseline.txt).

The same legacy helper is used by ordinary Case creation, create-from-Indicator, create-from-ASM Alert/Finding, and the Phase 1 Monitoring and Phase 2 Correlation paths. Case V2 already locked the tenant row and chose the highest number in the current year, but had its own numbering code. These paths therefore did not share an allocation lock or sequence.

## Change

`allocateCaseNumber(tx, tenantId)` now takes a PostgreSQL `FOR UPDATE` lock on that tenant's existing row **inside the caller's Case creation transaction**. It reads the maximum numeric suffix among that tenant's `CASE-<current-year>-<number>` records and returns the next padded number. Both legacy and Case V2 creation call this helper. The tenant row serializes all cooperating Case writers, including different Monitoring findings and different Correlation alerts. The lock and number read roll back with the Case, source link, Case activity and audit if a later operation fails. There is no global sequence, new table, migration, or change to the `CASE-YYYY-00001` format.

This also preserves historical numbers and avoids recycling deleted suffixes below the maximum. A new tenant starts at `00001`; a new calendar year starts from that year's maximum. Existing 91 migration files were not edited. The optional caller transaction introduced in Phase 1 and the Phase 2 Alert–Case transaction remain intact. The duplicate Tenant lock in Case V2 is harmless and preserves its existing early serialization of idempotency and source checks.

## Disposable PostgreSQL evidence

One QA database, `cti_corr_qa_sict40`, received all **91 existing migrations**. It was renamed to `cti_soar_qa_sict40` only for the SOAR sandbox regression. The active `cti` database was never connected to. `backend/.env` in the main workspace was read only to derive a separate QA URL. The database and transient QA state were deleted after testing.

| Check | Observed result |
| --- | --- |
| Two simultaneous authenticated manual Case requests | Both `201`; `CASE-2026-00001`, `...00002`; two Cases and two `CASE_CREATED` audits. [Raw log](sicti-pr7-case-allocator-direct.txt). |
| Two different confirmed Monitoring findings | Both `201`; `...00021`, `...00022`. |
| Two different worker-created Correlation alerts | Both `201`; `...00023`, `...00024`. |
| Monitoring and Correlation concurrently | Both `201`; `...00025`, `...00026`. |
| Monitoring and Case V2 concurrently | Both `201`; `...00027`, `...00028`. |
| Historical number and gap | A pre-existing `...00020` remained unchanged; deleted `...00019` was not reused; the next Case was `...00021`. |
| Repeat, rollback, tenant and audit | Repeated source requests returned the original Case; a forced post-insert failure left its finding unlinked and no extra Case/audit; foreign requests returned 404; the foreign tenant's first Case was `...00001`. One Case and the expected link audit committed per successful source. [Workflow log](sicti-pr7-case-allocator-workflows.txt). |
| Correlation integration after allocator change | Same-worker Alert link, create, denial, rollback and restart test passed. |
| SOAR after database rename | The linked worker Alert and Case completed independent approval and loopback sandbox verification: run `cmwiwnl890082gpjcgilwg0xg`, status `VERIFIED`. [SOAR log](sicti-pr7-case-allocator-soar.txt). |

The final combined focused run passed **13/13** Case allocator, Monitoring/Correlation and create-from-Indicator tests. [Focused log](sicti-pr7-case-allocator-focused.txt). Case/Monitoring/Correlation/SOAR unit regressions passed **5 suites, 23 tests**. [Unit log](sicti-pr7-case-allocator-unit.txt). Backend build passed [build log](sicti-pr7-case-allocator-build.txt); `prisma validate` and `git diff --check` passed. No frontend file changed in Phase 3.

## Changed files

- `backend/src/cases/case-number.ts` — shared transactional allocator.
- `backend/src/cases/cases.service.ts` — legacy entry points use the shared allocator; existing Phase 1/2 changes preserved.
- `backend/src/cases/cases-v2.service.ts` — Case V2 uses the same allocator.
- `backend/src/cases/cases.from-indicator.spec.cjs` — test transaction stub supports the shared SQL contract.
- `backend/src/cases/case-number-concurrency.integration.spec.cjs` and `case-number-workflows.integration.spec.cjs` — authenticated PostgreSQL HTTP coverage.
- This report and the sanitized raw logs linked above.

## Residual risks and PR gates

The allocator removes duplicate committed numbers for these cooperating Case creation paths. A request waiting more than Prisma's default interactive transaction timeout can still fail safely and roll back; no sustained-load latency or bounded retry policy was established here. Direct database writers outside these services must use the same tenant lock to share the guarantee. This phase did not change entitlement, tenant, audit, source lifecycle, or frontend behavior.

PR #7 still needs mandatory CI checks on its final commit, reviewable evidence attached to that commit, reconciliation with overlapping UX changes, fresh authenticated browser visual QA for the Phase 2 Case/Correlation affordances, and final merge/security approval. No commit, push, merge, deployment, or real mitigation connector activation occurred.
