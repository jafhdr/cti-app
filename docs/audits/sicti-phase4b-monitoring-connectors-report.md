# SICTI Phase 4B — Authorized Monitoring Connectors

**Date:** 2026-11-14\
**Verdict:** **PHASE 4B DEVELOPMENT CLOSED** for the isolated synthetic QA implementation. This verdict does not authorize live collection or assert dark-web coverage.

## Architecture and changed files

Phase 4B extends the Phase 4A tenant-scoped monitoring foundation with a versioned connector contract and a loopback-only simulated provider. An authorized monitoring source can be enabled for scheduled collection. PostgreSQL stores a durable collection job, due time, lease, retry count, status, failure code, and collection history. The worker claims due jobs, verifies a signed provider response and synthetic evidence digest, then uses the existing idempotent ingestion, matching, review, Alert, and Case path. A timed scheduler and worker serve normal QA operation; guarded manual schedule/process endpoints support deterministic QA and recovery testing.

| Area | Changed files |
| --- | --- |
| Database | `backend/prisma/schema.prisma`; additive `20261112100000_phase4b_monitoring_connectors/migration.sql` |
| Connector and privacy | `backend/src/intelligence/monitoring-connector.contract.ts`, `monitoring-collector.service.ts`, `monitoring-identity.ts`, `monitoring.dto.ts`, `monitoring.service.ts`, `monitoring.controller.ts`, `intelligence.module.ts` |
| Simulator and QA | `backend/qa-phase4b-simulator.cjs`, `qa-phase4b-server.cjs`, `qa-phase4b-browser.ps1`, `backend/src/intelligence/monitoring.collector.integration.spec.cjs`, `monitoring-identity.spec.ts`, `monitoring.http.integration.spec.cjs`, `frontend/e2e/phase4b-monitoring-browser.cjs` |
| Workspace | `frontend/components/intelligence/monitoring/MonitoringWorkspace.tsx`, `frontend/DESIGN.md` |

## Connector and security contract

The v1 JSON request and response are schema checked and HMAC-SHA256 signed with a QA-only 32-byte secret. The simulator accepts only loopback requests with a fresh timestamp, verifies the signature, and applies a 5-request/second limit. The collector fixes the destination to `127.0.0.1`, uses timeouts, bounds retries to three attempts, and records safe failure reasons. Job leases permit recovery after a worker restart. Source authorization is bound to an active tenant catalog source; disabling the connector or deleting that source stops subsequent collection. Provider event keys and source IDs suppress duplicate observations on replay. The simulated provider supplies synthetic brand exposure only; its coverage label is provider-supplied metadata, not verified real coverage.

The connector is disabled unless `SICTI_ISOLATED_QA`, `SICTI_MONITORING_QA_ENABLED`, and `SICTI_MONITORING_CONNECTOR_QA_ENABLED` are all true and the database name matches `cti_phase4a_qa_*`. The QA simulator URL is loopback-only. No production provider credentials, underground scraping, stolen credentials, or external collection were used.

Identity watches now use a tenant-separated HMAC digest derived from a versioned 32-byte secret. Ingestion computes the active version and can match a watch made with an available older key during rotation. The service accepts transient identity input, stores only keyed digests and masked labels, and rejects legacy unkeyed watch enrollment; the migration deactivates existing unkeyed identity watches pending re-enrollment. Raw passwords and authentication tokens are excluded by the strict observation DTO. Ordinary detail responses omit identity digests. The operator can redact an observation with a reason; the redaction and expiration scrub clear identity digest, domain, and evidence reference while retaining append-only audit and review history. TLP RED access restrictions and Phase 4A tenant/RBAC guards remain in force.

Evidence is an opaque `qa://` reference plus a SHA-256 digest of synthetic event fields, with provenance, provider publication time, local collection time, observation time, retention deadline, and TLP. The worker verifies the digest before ingestion. This is an encryption-compatible reference contract; no external encrypted blob store or real evidence resolver is present.

## Collection metrics and operator view

The workspace shows connector enablement, next due time, last success, safe failure reason, coverage label, and recent job history. Jobs record local collection and processing latency separately. The observation detail distinguishes provider-published time from locally collected time so upstream publication delay is not represented as collector latency. These measurements were displayed in the authenticated browser run; the simulator does not support claims about real-world provider delay or coverage.

## Verification

| Check | Result |
| --- | --- |
| Prisma | Schema validated; additive migration applied to disposable `cti_phase4a_qa_20261111`; 90 migrations up to date. The active `cti` database was untouched. |
| Production builds | Backend Nest build, frontend TypeScript check, and frontend Next build passed after the Phase 4B changes. |
| Backend units | Jest **33 suites / 242 tests passed** on 2026-11-14. |
| PostgreSQL and simulator | Phase 4B integration **1/1 passed**: signed simulator, scheduled job, bounded retry, expired-lease replay, idempotence, tenant isolation, manual rate limit, disabled gate, invalid signature, HMAC key rotation, and audited redaction. Phase 4A HTTP regression and isolated full AppModule authentication **1/1 each passed**. |
| Authenticated Chrome | [Browser evidence](sicti-phase4b-browser-evidence.json) **PASS**: tenant watchlist → authorized simulator → scheduled collection → synthetic finding → analyst review → Alert/Case. Fresh [desktop](sicti-phase4b-monitoring-desktop.png) and [390px mobile](sicti-phase4b-monitoring-mobile.png) captures show connector status, history, timestamps, safe evidence, and linked outcomes. Functional visual QA passed in `.omo/evidence/phase4b-visual-function.md`. |
| Prior capabilities | The full backend Jest run covers current unit regressions across Phase 1C, Phase 2, Phase 3C, ASM, and Case modules. Phase 4A's report records prior isolated integration coverage; its wider cross-phase integration suite was not repeated for this Phase 4B run. |

## Limits and minimal Phase 4C recommendation

The connector is a QA simulator with a shared QA secret and loopback transport. Production still needs a separately authorized provider, license and scope verification, credential vault integration, provider-specific contract tests, encrypted evidence storage and resolver, production retention/purge scheduling, key rotation operations with re-enrollment, observability under sustained load, and end-to-end cross-phase regression in a staging environment. In particular, old HMAC keys must remain available while older identity watches are active. The current UI retrieves a bounded history, and provider coverage is not independently audited.

**Phase 4C should be limited to final development closure:** exercise the above staging controls with authorized non-sensitive fixtures, prove retention/key rotation and recovery at operational load, rerun the full guarded cross-phase regression matrix, and record a production-readiness decision. Do not activate a live provider until its authorization, licensing, scope, and data-protection controls are separately verified.
