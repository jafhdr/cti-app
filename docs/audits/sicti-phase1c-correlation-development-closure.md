# SICTI Phase 1C — correlation security, reliability, and development closure

**Date:** 9 November 2026\
**Workspace:** `.sicti-flagship-baseline` only\
**Verdict:** **DEVELOPMENT CLOSED** for the isolated Phase 1/1B/1C correlation scope. Production activation and a contractual 60-second SLA are not established.

## Security and implementation

- Added additive migration `20261109120000_correlation_connector_credentials` and `CorrelationConnectorCredential` with tenant ownership, SHA-256 hash of a 256-bit random secret, fixed `telemetry:write` scope, expiration, rotation lineage, revocation, and last-use timestamp. The full token is returned only on issue/rotation; list responses omit hashes and secrets. Admin lifecycle actions have audit records.
- Machine credentials are accepted only as `Authorization: SICTIConnector <token>` at `POST /threat-correlations/machine/events`. This route cannot read alert lists, manage credentials, or access other authenticated endpoints. Admin issuance, rotation, listing, and revocation retain existing role, tenant, subscription/module, and feature guards.
- Machine ingestion, credentials, queue processing, status, and analyst APIs remain disabled unless both QA flags are true and the database name matches `cti_corr_qa_*`. Cross-tenant payloads are rejected. Expired, revoked, malformed, and old rotated tokens are rejected.
- Added attempt fencing to worker claims and corrected the raw SQL lease comparison to UTC. A stale worker cannot commit an older attempt after a newer claim. Claiming remains bounded with `FOR UPDATE SKIP LOCKED`, a 20-event batch, four concurrent processors, three attempts, backoff, and the 500-event per-tenant queue limit.
- Correlation notifications now have authorized tenant recipients. RED telemetry is withheld from regular user status/list views, and RED notifications go only to tenant admins. Correlation evidence, alert, notification, and audit records are transactionally consistent.

## Phase 1C changed files

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20261109120000_correlation_connector_credentials/migration.sql`
- `backend/src/correlation/correlation-credentials.service.ts`
- `backend/src/correlation/correlation-credentials.controller.ts`
- `backend/src/correlation/correlation-connector.service.ts`
- `backend/src/correlation/correlation-queue.service.ts`
- `backend/src/correlation/correlation.service.ts`
- `backend/src/correlation/correlation.module.ts`
- `backend/src/correlation/correlation.security.integration.spec.cjs`
- `backend/qa-correlation-sustained.cjs`
- `backend/qa-correlation-worker.cjs`
- `backend/qa-correlation-restart.cjs`
- `frontend/e2e/correlation-phase1c-browser.cjs`

All earlier Phase 1/1B, ASM V2, Case V2, and V1 work and migration history were preserved. The existing analyst UI rendered machine-origin correlations without a component change.

## Validation

| Gate | Result |
|---|---|
| Prisma schema validation and client generation | Passed |
| Disposable PostgreSQL migration and seed | 79 migrations applied; passed |
| Backend build | Passed |
| Frontend production build | Passed |
| Backend unit regression | 24 suites, 208 tests passed |
| Correlation HTTP and machine security integration | 2 suites passed sequentially on the QA database |
| Existing feed provenance and indicator correlation integration | 8 tests passed |
| Actual worker process stop/restart | Passed: 25 queued during downtime, recovered after process restart with no duplicate alerts |
| Authenticated Chrome E2E | Passed: real analyst login, machine token issue, machine telemetry, automatic match, analyst alert, credential revocation |

The security integration checked unauthorized and cross-tenant requests, malformed credentials, one-time token disclosure, source-key idempotency and conflict, expiration, rotation, revocation, default-off behavior, RED visibility and recipients, stale leases, concurrent worker claims, retry after a temporary feed error, correlation evidence, exact alert count, notification recipients, and audit trails. The prior Phase 1B integration additionally covers invalid telemetry, duplicate, delayed, suppressed, expired, and retry-exhaustion scenarios.

## Sustained-load method and measurements

[Raw sustained-load results](sicti-correlation-phase1c-sustained.json) come from one repeatable 90-second QA run using machine authentication: 720 events at 12/s for 60 seconds, then 720 at 24/s for 30 seconds. The worker was deliberately paused for 10 seconds during the 12/s phase, allowing queue depth to grow, then resumed. The test sampled queue depth approximately once per second and used a 100 ms database-completion monitor followed by an authenticated HTTP status read for each event. Time from API receipt to that successful read is reported below. Upstream observation-to-receipt delay is a separate synthetic ~2-second value. The workload ran on one Windows host with one disposable database; the QA Prisma pools were capped at two connections because the shared PostgreSQL instance already had substantial unrelated connection use.

| Workload | Completed | Receipt → readable alert p50 | p95 | p99 | Max | Processing p99 | Upstream p99 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 12/s for 60 s, 10 s worker pause | 720/720 | 265 ms | 7,743 ms | 9,785 ms | 10,349 ms | 9,643 ms | 2,034 ms |
| 24/s for 30 s | 720/720 | 256 ms | 364 ms | 390 ms | 435 ms | 295 ms | 2,054 ms |

**Failure rate:** 0/1,440 submissions and 0/1,440 missing alerts. **Maximum sampled queue depth:** 114. The last one-second sample showed 5 queued events; a final PostgreSQL query after completion verified depth **0**. The 10-second pause caused the high p95/p99 in the first phase, and processing recovered without manual requeue.

[Worker restart evidence](sicti-correlation-phase1c-restart.json): the first 10 events drained in 337 ms; after the worker process was stopped, 25 events remained queued, then drained in 879 ms after a new worker process started. Duplicate alerts: 0.

[Authenticated desktop screenshot](sicti-correlation-phase1c-desktop.png) · [mobile screenshot](sicti-correlation-phase1c-mobile.png). In that browser run, receipt-to-authenticated-API readability was **279 ms**, receipt-to-rendered-analyst-card **454 ms**, application processing **157 ms**, and synthetic upstream acquisition **28 ms**. These are one-case browser observations, separate from the sustained workload distribution.

## Debugging and limits

An initial sustained run produced Prisma `P2037` (`too many clients already`) because the shared PostgreSQL server allowed 100 connections and another database held 78. The isolated QA harness now caps its Prisma pools; the same sustained workload completed without this error. An older synthetic feed fixture also crossed the five-minute matching window during repeated runs; the harness refreshes only its disposable feed observation at each start. Neither change weakens the product matching rule.

- These measurements are local synthetic QA, not a production topology, true upstream acquisition stream, sustained multi-hour load, multi-region network test, or a contractual 60-second SLA demonstration.
- The exact IOC/five-minute rule and 200-observation cap remain. Production-grade machine onboarding still needs secret storage/rotation operations, TLS termination, rate limiting beyond queue capacity, deployment monitoring, and a dedicated database connection budget.
- No production SIEM, EDR, firewall, cloud connector, SOAR action, predictive ML, or dark-web feature was activated.

**Next task, after separate approval:** scope and plan Phase 2 Predictive Threat Actor Profiling, starting with its data contract, source quality controls, explainability, and evaluation criteria. No Phase 2 implementation was started.
