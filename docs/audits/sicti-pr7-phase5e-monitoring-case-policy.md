# SICTI PR #7 Phase 5E-C — Monitoring Inactive-Case Policy

Date: 2026-11-23 (Asia/Jakarta)
Reviewed HEAD: `3594b105b53e721d587dc574967c170514eb6265`

## Verdict

**MONITORING CASE POLICY READY FOR COMMIT REVIEW**

Monitoring now applies the same active-Case rule already enforced by Correlation: a new relationship may target an `OPEN` or `IN_PROGRESS` Case, while a new relationship to a `RESOLVED` or `CLOSED` Case receives HTTP 409 (`Case is not active`).

## Policy decision

No existing requirement authorized Monitoring to create new relationships to inactive Cases. The established Correlation implementation, Case V1 lifecycle (`OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED`, with the supported reopen paths), Case V2 closure/reopen workflow, dashboard active-Case definition, and operational reporting all treat `RESOLVED` and `CLOSED` as inactive.

Historical relationships are preserved. If a Monitoring finding is already linked, an idempotent repeat for that same Case returns the existing relationship even after the Case later becomes inactive. A request attempting to redirect the finding to another Case remains a conflict.

## Implementation

`MonitoringLinksService.case()` retains the existing tenant-scoped finding row lock and transaction. For a caller-supplied Case, it now selects the tenant-scoped Case row with `FOR UPDATE`, reads its status under that lock, and rejects `RESOLVED`/`CLOSED` before any finding update or audit insert.

The Case lock makes the status check and relationship write serializable with concurrent Case status updates:

- a link holding the Case lock completes against the active state before a later status transition;
- a status transition that acquires the row first commits before the link reads status, so the link observes the inactive state and rejects;
- rejected requests roll back without relationship or audit writes.

No schema, migration, controller, DTO, RBAC, or connector change was required.

## Focused regressions

Environment: Node.js 22 container, PostgreSQL 16 container, committed 91-migration chain, synthetic seed and credentials only. Production connectors and background workers were disabled.

### Monitoring–Case

Database: `cti_phase4a_qa_sict36policy68`

Command:

```text
node --test --test-concurrency=1 src/intelligence/monitoring-case-concurrency.integration.spec.cjs
```

TDD evidence:

- Red on reviewed implementation: expected 409, received 201 for a new link to a `RESOLVED` Case; 0/1 passed.
- Green after the service guard: 1/1 passed, 0 failed, duration 2.469 seconds.
- Final focused rerun after adding the explicit `IN_PROGRESS` positive assertion: 1/1 passed, 0 failed, duration 2.723 seconds on `cti_phase4a_qa_sict36policy69`.

The integration scenario explicitly covers successful `OPEN` and `IN_PROGRESS` linking, `RESOLVED` and `CLOSED` rejection, cross-tenant denial, RBAC denial, unauthenticated denial, existing-link replay after resolution, concurrent linking without duplicate/orphan Cases, transaction rollback, rejected-request write/audit absence, and a concurrent status change that blocks on the Case row lock before returning 409.

### Correlation–Case

Database: `cti_corr_qa_sict68policy`

Command:

```text
node --test --test-concurrency=1 src/correlation/correlation-case.http.integration.spec.cjs
```

Result: 1/1 passed, 0 failed, duration 2.765 seconds. Existing Correlation tenant/RBAC, idempotency, atomic linking, rollback, audit, Case creation, restart, and SOAR relationship behavior remains intact. Code inspection confirms its existing `RESOLVED`/`CLOSED` conflict guard is unchanged.

### Build

`npm run build` passed under Node.js 22 after the TypeScript change.

## Remaining risks and boundaries

- PostgreSQL row locking intentionally serializes a link with a concurrent status transition for the same Case; this adds only per-Case contention and avoids a stale-status relationship.
- The policy does not delete or rewrite historical relationships.
- This phase does not authorize production connectors, production database access, merge, deployment, or changing PR #7 from Draft.
- Separate PR-wide gates remain: unified staging/E2E, frontend-overlap acceptance, final-SHA review, and human approval.

## Changed files

- `backend/src/intelligence/monitoring-links.service.ts`
- `backend/src/intelligence/monitoring-case-concurrency.integration.spec.cjs`
- `docs/audits/sicti-pr7-phase5e-monitoring-case-policy.md`

No commit or push was performed.
