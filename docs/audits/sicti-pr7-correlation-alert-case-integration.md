# PR #7 Phase 2 — Correlation Alert–Case integration

**Date:** 2026-11-16 (Asia/Jakarta)\
**Base:** `797cbb9669c24b9f9cfbf70c93e04cfa90f9d8a6`\
**Verdict: PASS WITH LIMITATIONS.** The authenticated relationship and same-Alert SOAR sandbox path passed on disposable PostgreSQL. Browser visual QA was not completed, and the pre-existing Case-number allocator remains a merge gate. PR #7 remains Draft and unchanged.

## Contract and implementation

`Alert.caseId` already represents the relationship; no migration was added. The Correlation controller retains its `threat-intelligence` / `indicator-management` guards and adds a second `case-management` / `case-workflow` entitlement check. Only ADMIN and SUPER_ADMIN can mutate; USER may read a visible AMBER/non-RED alert's linked Case. SUPER_ADMIN must supply `tenantId`; foreign Alert or Case IDs return 404 without exposing records. Existing Case detail authorization remains in place.

| Request | Result |
| --- | --- |
| `POST /threat-correlations/alerts/:alertId/case` with `{"caseId":"<same-tenant-case-id>"}` | Attach an eligible, non-closed Correlation Alert to an active Case; return `{alertId,case,created:false,repeated:false}`. |
| Same POST with `{"createCase":true}` | Create a Case through `CasesService.create(..., tx)` and attach in the same transaction; return `created:true`. |
| Repeat same Case ID or `createCase:true` after a link exists | Return the existing Case with `repeated:true`, with no new Case, activity, or link audit. |
| Explicit different Case ID after a link exists | 409. Foreign Case ID or foreign Alert ID: 404. |
| `GET /threat-correlations/alerts/:alertId/case` | Return `{alertId,case}` (null until linked), with tenant, entitlement, and RED visibility checks. |
| `GET /cases/:id` | Existing ASM alerts plus linked Correlation alerts, with RED Correlation alerts omitted for USER. |

The attach path takes a tenant-qualified PostgreSQL `FOR UPDATE` lock on the Alert, rechecks the Correlation and current indicator eligibility after the lock, and checks Case lifecycle. The Case insert, `Alert.caseId` update, `CORRELATION_ALERT_LINKED` Case activity, and `CORRELATION_ALERT_CASE_LINKED` audit commit together. Case creation also records its existing `CASE_CREATED` activity/audit. An induced error after Case insertion rolled all of these back. No new association or Case V2 origin was invented.

The Correlation workspace now links directly to a linked Case, and Case detail has a separate Correlation alert section. Existing ASM provenance remains separate. Links are standard keyboard-accessible anchors with descriptive text.

## PostgreSQL and HTTP evidence

One disposable database was created as `cti_corr_qa_sict39`, received **all 91 existing migrations**, and was later renamed to `cti_soar_qa_sict39` for the SOAR guard. The active `cti` database was not connected to; its `.env` URL was read only to derive the separate QA connection. The source is the local backend `.env` identified by the user.

The test `backend/src/correlation/correlation-case.http.integration.spec.cjs` submitted `POST /threat-correlations/connector/events`, ran `CorrelationQueueService.drainOnce()`, and used that worker-created Alert. It checked unauthenticated 401, USER and missing Case grant 403, foreign Alert and Case 404, two simultaneous identical attach requests, conflicting 409, repeat create, Case detail, one link audit/activity, induced rollback, successful create-from-alert, and persistence after Nest restart. **1/1 test PASS**, 4.1 s in the final run. The linked Case foreign key was `Alert.id=cmwiw8jq9001sgpwor8tb9z6q` → `Alert.caseId=cmwiw8jhl001ggpwoej7rwgmw`; `PlaybookRun.id=cmwiw8k770026gpwolonn9v09` reused that Case ID. The test asserted one `CORRELATION_ALERT_CASE_LINKED` and one `CORRELATION_ALERT_LINKED` for that first link, then two link audits total after the separate successful create-from-alert. The failed create left its Alert unlinked and the Case count unchanged.

After the rename, `backend/src/correlation/correlation-case-soar.http.integration.spec.cjs` read that same persisted run and verified its Alert and Case IDs, rejected sandbox execution before approval, recorded initiator `CONFIRM` and separate analyst `APPROVE`, queued a loopback-only sandbox domain action, and observed `VERIFIED`, a successful job, `STATE_VERIFIED` event, and `STATE_VERIFIED` receipt. **1/1 test PASS**, 3.0 s. Run `cmwiw8k770026gpwolonn9v09`, job `cmwiw8vnq000dgpgkr4w091ca`. No real mitigation connector was activated.

Additional checks: backend `npm run build` passed; focused Jest Correlation rules and Case assignment passed **2 suites / 9 tests**; frontend `npm run typecheck` passed; final frontend production build passed; `git diff --check` passed. The first sandbox attempt exposed a test fixture domain that did not meet the existing synthetic three-label `.test` contract; the fixture was corrected to `bad-<UUID>.qa.test`, and the final same-database run passed. A first unprivileged Next build was blocked by process-spawn EPERM; the allowed rerun completed.

## Files and remaining gates

- `backend/src/correlation/correlation-case.service.ts` — transactional relationship service.
- `backend/src/correlation/correlation.controller.ts`, `correlation.module.ts`, `correlation.service.ts` — endpoints, provider, and list Case ID.
- `backend/src/cases/cases.service.ts` — include Correlation alerts in Case detail; accepted Phase 1 transaction parameter remains intact.
- `backend/src/correlation/correlation-case.http.integration.spec.cjs`, `correlation-case-soar.http.integration.spec.cjs` — PostgreSQL HTTP evidence.
- `frontend/components/intelligence/correlations/CorrelationWorkspace.tsx`, `frontend/app/cases/[id]/page.tsx` — minimal navigation/detail affordances.
- This report.

The **Case-number allocator** still uses tenant Case count plus one. Simultaneous creation from different alerts may collide on the unique Case number; this separate issue must be resolved before PR merge. Same-Alert locking prevents orphan Cases for this path but does not solve that allocator. The default Prisma interactive transaction timeout remains an operational high-contention limit. A fresh authenticated browser visual QA capture for the two UI surfaces was not produced, so visual acceptance remains open. No commit, push, merge, deploy, or PR status change was made.
