# SICTI Phase 3B — secure sandbox connector

**Date:** 11 November 2026\
**Workspace:** `.sicti-flagship-baseline` only\
**Verdict:** **PHASE 3B DEVELOPMENT CLOSED** for an isolated synthetic-domain sandbox connector. This is not a production mitigation integration.

The available `../uiux/CTI.pdf` supports SIEM/SOAR integration, automated response workflows, RBAC, audit trails, and TLP enforcement (notably pages 8, 32–33, and 42). `Product_SISI.pdf` was not present in the workspace, so its page 11 could not be checked in this phase. The Phase 3A report and Phase 1C/Phase 2 reports supplied the implementation baseline.

## Architecture and changed files

Phase 3B extends the Phase 3A Playbook module without changing correlation alerts or Case lifecycles. `backend/prisma/schema.prisma` and additive migrations `20261111090000_soar_sandbox_connector` and `20261111091000_soar_sandbox_operator` add tenant-owned connector jobs, immutable connector events, bounded attempts, unique action request IDs, and operator attribution. The migrations were applied to the existing disposable `cti_soar_qa_20261110133159` database; existing migrations and the active `cti` database were not changed.

`backend/src/playbooks/sandbox-contract.ts` defines version 1 signed action/state schemas and synthetic `.test` target policy. `sandbox-client.ts` sends bounded HTTP requests to loopback only. `sandbox-connector.service.ts` enforces tenant, module and RBAC through the existing controller guards, the Phase 3A confirmation and independent approval decisions, QA gating, queue idempotency, and safe abort. `sandbox-worker.ts` claims durable jobs, retries with exponential backoff, recovers expired leases, records acknowledgements and failures, independently queries tool state, writes immutable evidence, and completes or fails block/rollback runs. `playbook.controller.ts`, `playbook.module.ts`, and `playbook.service.ts` expose the connector workflow while preserving the Phase 3A simulation path for its original non-`.test` fixtures. A `.test` run cannot use the Phase 3A receipt-only execute endpoint.

`backend/qa-phase3b-mock-tool.cjs` is a separate loopback mock security-tool server with its own simulated blocked-domain set and request-ID cache. `qa-phase3b-fixture.cjs`, `qa-phase3b-inspect.cjs`, and `qa-phase3b-browser.ps1` are QA-only helpers. The Playbook workspace in `frontend/components/intelligence/playbooks/PlaybookWorkspace.tsx` shows queue state, attempts, signed-tool acknowledgements, independent verification, rollback, terminal failures, and immutable event history. It retains the established `frontend/DESIGN.md` editorial system; `frontend/e2e/phase3b-sandbox-browser.cjs` drives the two-analyst browser path.

## Connector security

The connector is disabled unless `SICTI_SOAR_QA_ENABLED=true`, `SICTI_ISOLATED_QA=true`, the database name matches `cti_soar_qa_*`, a 32-character-or-longer secret is configured, and the URL is exactly an unauthenticated `http://127.0.0.1:<port>/` origin without path, query, or embedded credentials. The secret is read from process environment, never persisted in Playbook tables or logged. The mock tool and client authenticate request and response bodies with HMAC-SHA256. Version 1 requests include tenant ID, unique request ID, nonce, and millisecond timestamp; the mock rejects reused nonces and timestamps outside 30 seconds. The client checks signed response identity, operation, and freshness. The mock accepts only explicit `BLOCK_DOMAIN` and `UNBLOCK_DOMAIN` operations and domains ending in `.test`; rejected targets cannot reach an action. There is no production destination, production credential, firewall, EDR, SIEM, or cloud adapter.

## Execution, verification, and rollback

An eligible correlation alert creates the original Phase 3A run. The initiating analyst confirms it; a different analyst approves it. The operator can then queue a synthetic block. A PostgreSQL job records the operation and request ID before the worker sends anything. A unique `(run, operation)` key makes repeated queue requests idempotent. The worker uses a lease and at most three attempts with bounded backoff and a three-second HTTP deadline. After a signed action acknowledgement it makes a **separate signed state query**. Only a matching blocked state creates a verified receipt and moves the run to `VERIFIED`. The tool's initial acknowledgement alone cannot verify success.

An authorized operator can queue `UNBLOCK_DOMAIN` only from a verified connector run. A separate state query must show `blocked=false` before the run becomes `ROLLED_BACK`. Rollback failure becomes `ROLLBACK_FAILED`. An unclaimed block can be aborted; queued rollback cannot be aborted because the block may still be active. Retry, failure, acknowledgement, and state-check history is append-only in `SandboxConnectorEvent`, with a database trigger rejecting updates/deletes. Existing Phase 3A decisions and receipts remain immutable. Alert and Case statuses are not mutated by connector work.

## Test and integration evidence

| Gate | Observed result |
|---|---|
| QA database budget | PostgreSQL had 9/100 connections in use at inspection; focused QA limited Prisma pools to two per process. The pre-existing disposable SOAR QA database was reused. No unrelated connections were terminated. |
| Prisma/migrations | Schema validated; 86 migrations, including two additive Phase 3B migrations, applied successfully to the disposable SOAR QA database. |
| Builds and unit tests | Backend Nest build, frontend type check, and production Next build passed. Jest: **30 suites, 233 tests passed**, including target/signature/timestamp/loopback contract tests. |
| Phase 3B PostgreSQL HTTP | Passed two-analyst approval, default-off Phase 3A bypass rejection for `.test`, tenant/RBAC denial, concurrent/idempotent queue requests, block acknowledgement, independent tool-state check, immutable event rejection, safe abort, rollback and verified restoration, replayed-signature rejection, and unchanged alert status. |
| Failure and recovery PostgreSQL | Passed connector outage, bounded retry, worker restart with the same durable request ID and one successful acknowledgement, verification mismatch without a verified receipt, delayed response recovery, and terminal rollback failure after three attempts. |
| Existing Phase 3A | Authenticated PostgreSQL simulation regression passed on the disposable SOAR QA database. |
| Phase 1C / Phase 2 / Case | Correlation HTTP integration passed 1/1 with the pilot flag; Phase 2 PostgreSQL integrations passed 6/6 with fresh QA fixtures; Case regressions passed 31/31 with an explicit QA database guard. |
| Authenticated Chrome E2E | Passed correlation alert → trigger → initiator confirmation → different analyst approval → queued synthetic block → independent verified state → operator rollback → verified restored state. [Browser evidence](sicti-phase3b-browser-evidence.json) records two successful jobs and both state-verification events. |
| Fresh visual QA | Independent function and visual-fidelity reviews approved the final full-page captures: [block verified desktop](sicti-phase3b-block-verified-desktop.png), [restored desktop](sicti-phase3b-restored-desktop.png), and [restored mobile](sicti-phase3b-restored-mobile.png). No clipping or horizontal overflow was observed. |

The first Phase 1C rerun used the pilot flag off and the first Phase 2 rerun reused a fixture whose technique had been modified by an earlier historical-catalog test. Both passed after restoring the intended QA flag and generating fresh disposable Phase 2 fixtures. A Case regression invocation without a QA database guard was rejected automatically; the guarded rerun passed. The final browser run used the compiled Auth, Correlation, and Playbook modules with a production-built frontend. Full `AppModule` runtime coverage was not claimed. The active `cti` database was never used for tests or modified.
The Phase 3A/3B QA credential fixture files were removed after validation; synthetic database rows and non-secret screenshots/evidence remain for inspection.

## Limits and remaining SOAR work

The mock tool keeps block state and replay cache in memory. Restarting that mock process loses both; the worker restart test keeps the tool contract alive or replays an action that had failed before application. The connector is intentionally loopback-only and cannot be pointed at a real tool. There is no callback endpoint, so duplicate callbacks are rejected as unsupported routes rather than processed; polling is the sole response mechanism. A terminal rollback failure requires manual QA investigation; no automatic compensation can prove restoration if the tool remains unavailable. The UI refreshes status on demand. Historical receipts prove synthetic tool state at verification time, not real-world blocking effectiveness.

**Minimal tasks before SOAR development closure beyond this sandbox phase:** persist mock-tool state and nonce/request replay history across its own restart; add a connector-neutral signed callback contract only if asynchronous production tools require callbacks; implement operator-guided recovery after terminal rollback failure; and run a full-module security/operations review with production credential storage, destination allowlists, incident response runbooks, and tool-side audit correlation before proposing any real adapter. No additional phase was implemented, and no commit, push, merge, or deployment was performed.
