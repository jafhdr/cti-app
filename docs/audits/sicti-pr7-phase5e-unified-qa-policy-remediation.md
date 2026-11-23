# SICTI PR #7 — Phase 5E-D1 secure unified QA runtime remediation

**Date:** 23 November 2026 (Asia/Jakarta)
**Repository / PR:** `jafhdr/cti-app` / Draft PR #7
**Source HEAD:** `76c1ac40c1bb518f097c714480d24823ff668829`
**Verdict:** **UNIFIED QA POLICY READY FOR COMMIT REVIEW**

## Result

Correlation, SOAR, and Monitoring can now initialize together against one stable database identity matching `^cti_unified_qa_[a-z0-9]+$`. The unified identity is accepted only when both the subsystem feature flag and `SICTI_ISOLATED_QA=true` are present, plus the new explicit `SICTI_UNIFIED_QA_ENABLED=true`. Existing subsystem-specific QA identities remain accepted unchanged.

No production database, provider, worker, mitigation connector, schema, migration, or external service was used. The implementation was validated locally and was not committed or pushed.

## Updated policy

`backend/src/qa-runtime-policy.ts` owns one typed policy for three module identities:

- Correlation: existing `^cti_corr_qa_[a-z0-9_]+$` or explicitly enabled unified identity.
- SOAR: existing `^cti_soar_qa_[a-z0-9_]+$` or explicitly enabled unified identity.
- Monitoring: existing `^cti_phase4a_qa_[a-z0-9]+$` or explicitly enabled unified identity.
- Unified: `^cti_unified_qa_[a-z0-9]+$`, requiring `SICTI_UNIFIED_QA_ENABLED=true`.
- Every path requires its existing module feature flag and `SICTI_ISOLATED_QA=true`.

The policy is used by all discovered runtime database guards: Correlation ingestion, Case linking, connector credentials, connector ingestion and queue worker; SOAR capabilities, execution and sandbox connector; Monitoring ingestion, retention scrub and simulated collector.

## Security boundaries preserved

- Tenant and RBAC code paths were not changed.
- Correlation still requires `THREAT_CORRELATION_PILOT_ENABLED=true`; its worker still respects `THREAT_CORRELATION_WORKER_ENABLED`.
- SOAR still requires `SICTI_SOAR_QA_ENABLED=true`.
- Monitoring still requires `SICTI_MONITORING_QA_ENABLED=true`; its collector additionally requires `SICTI_MONITORING_CONNECTOR_QA_ENABLED=true`.
- SOAR connector configuration still accepts only plain HTTP on `127.0.0.1`, a root path, no credentials/query/fragment, and a secret of at least 32 characters.
- SOAR actions still accept only synthetic `.test` targets and signed requests.
- Monitoring connector configuration is now independently unit-tested through `monitoring-collector-policy.ts`; it accepts only HTTP on `127.0.0.1` at `/v1/collect`, with no query or fragment.
- Unified policy does not enable a connector. During shared startup, SOAR simulation was enabled but connector capability remained disabled because no loopback connector was configured; Monitoring connector was explicitly disabled.
- Audit, transaction, concurrency, rollback and inactive-Case code was not weakened.

## TDD and focused unit results

The centralized policy was added red-first. The first clean red failed because `qa-runtime-policy` did not exist. A second red proved that the typed contract did not yet enforce the individual module flag. Monitoring endpoint policy was likewise added red-first and initially failed because the export did not exist.

Final focused Jest command covered:

- `src/qa-runtime-policy.spec.ts`
- `src/playbooks/playbook-policy.spec.ts`
- `src/playbooks/sandbox-contract.spec.ts`
- `src/intelligence/monitoring-collector.policy.spec.ts`

Result: **4/4 suites, 36/36 tests passed**. Positive cases cover every existing database identity and every module on `cti_unified_qa_sict72`. Negative cases cover missing unified/isolated/module flags, `cti`, arbitrary or malformed identities, cross-module identity reuse, non-loopback connectors, short connector secrets, and prohibited non-`.test` targets.

Backend build completed successfully after the final policy extraction.

## PostgreSQL 16 shared-runtime validation

A new container `sict72-pg` ran PostgreSQL 16 with only the disposable database `cti_unified_qa_sict72` exposed on local port 55472. All **91 committed migrations** applied and the committed synthetic seed completed after supplying its required QA-only password.

The final source build ran these harnesses serially against the same stable `DATABASE_URL`, with all three module flags, isolated-QA, and unified-QA enabled:

| Harness | Result | Evidence |
| --- | --- | --- |
| Full `AppModule` shared startup | **1/1 PASS** | CorrelationQueueService, MonitoringService and PlaybookService resolved together; SOAR simulation enabled; connector disabled. |
| Correlation HTTP regression | **1/1 PASS** | Synthetic URLhaus IOC and telemetry produced one tenant-visible alert. |
| Monitoring–Case concurrency/policy regression | **1/1 PASS** | Concurrent requests converged on one Case/link; foreign finding 404, foreign Case 404, reader 403, unauthenticated 401; rollback left the finding unlinked; inactive-Case and `IN_PROGRESS` assertions remained in the harness. |

Combined result: **3/3 passed, 0 failed** in 10.396 seconds. The migration ledger reported 91 completed, non-rolled-back migrations. The exact container was then removed; process-local credentials and flags ended with the commands.

## ASM and AppSec inspection

No ASM or AppSec runtime TypeScript database-name guard was found. Their remaining restrictions are integration-harness preconditions:

- ASM harnesses expect historical `cti_asm*` names, including the strict P1-D/fingerprint form `cti_asm62_qa_case20_<8 hex>`.
- AppSec closure harness expects `APPSEC_CLOSURE_QA_DB_NAME=stake49_closure_<10 hex>` matching `DATABASE_URL`.

These do not block application modules from initializing on the unified database, but the existing ASM/AppSec stateful harnesses cannot be reused unchanged for the next unified E2E run. They need narrowly reviewed harness support for the unified identity, not an application runtime allowlist change.

## Existing five-job CI compatibility

The workflow was not modified. Its current database identities remain explicitly accepted:

- Core regressions: `cti_corr_qa_sict40`.
- Monitoring atomicity: `cti_phase4a_qa_sict36ci`.
- SOAR stateful: `cti_soar_qa_sict65_ci`.
- ASM/AppSec stateful databases remain governed by their unchanged harnesses.
- Backend and frontend build jobs do not depend on the new unified flag.

Focused unit tests prove the three existing runtime identities remain valid without `SICTI_UNIFIED_QA_ENABLED`. The final backend build proves all workflow-compiled callers remain compatible. The complete remote matrix was intentionally not repeated.

## Exact changed files

New application/test files:

- `backend/src/qa-runtime-policy.ts`
- `backend/src/qa-runtime-policy.spec.ts`
- `backend/src/intelligence/monitoring-collector-policy.ts`
- `backend/src/intelligence/monitoring-collector.policy.spec.ts`
- `backend/src/unified-qa-runtime.integration.spec.cjs`

Updated Correlation files:

- `backend/src/correlation/correlation.service.ts`
- `backend/src/correlation/correlation-case.service.ts`
- `backend/src/correlation/correlation-connector.service.ts`
- `backend/src/correlation/correlation-credentials.service.ts`
- `backend/src/correlation/correlation-queue.service.ts`
- `backend/src/correlation/correlation.http.integration.spec.cjs`

Updated SOAR files:

- `backend/src/playbooks/playbook-policy.ts`
- `backend/src/playbooks/playbook-policy.spec.ts`
- `backend/src/playbooks/playbook.service.ts`
- `backend/src/playbooks/sandbox-connector.service.ts`

Updated Monitoring files:

- `backend/src/intelligence/monitoring.service.ts`
- `backend/src/intelligence/monitoring-collector.service.ts`
- `backend/src/intelligence/monitoring-case-concurrency.integration.spec.cjs`

Report:

- `docs/audits/sicti-pr7-phase5e-unified-qa-policy-remediation.md`

No schema, migration, workflow, frontend, authorization, or production configuration file changed.

## Remaining blockers for unified E2E

1. Add narrow unified-identity support to the ASM and AppSec integration harness guards, while preserving their existing identities.
2. Provision one new disposable unified database and create a single synthetic tenant with the full entitlements required by Scenarios A–D.
3. Execute connected Correlation → Case → SOAR, Monitoring → ASM → Case, and AppSec → Case workflows against shared records rather than independent fixtures.
4. Start the actual backend and frontend and capture authenticated populated Chromium evidence.
5. Verify final persisted cross-module foreign keys, audit events, idempotency, rollback, concurrency, tenant isolation and role denial before changing the Phase 5E-D verdict.

## Final verdict

**UNIFIED QA POLICY READY FOR COMMIT REVIEW**

The original stable-database blocker is remediated locally. Actual unified cross-module E2E remains a separate next phase and PR #7 remains Draft.
