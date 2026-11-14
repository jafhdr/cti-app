# SICTI Phase 3A — SOAR-ready playbook foundation

**Date:** 10 November 2026\
**Workspace:** `.sicti-flagship-baseline` only\
**Verdict:** **PHASE 3A DEVELOPMENT CLOSED** for a sandbox-only playbook foundation. No real blocking capability exists.

## Architecture and changed files

The new `PlaybookModule` reuses authentication, roles, Threat Intelligence module assignment, tenant context, correlation evidence, Case Management links, and `AuditLog`. `backend/prisma/schema.prisma` and additive migrations `20261110070000_soar_playbook_foundation` and `20261110071000_soar_case_link_detach` define tenant-owned `PlaybookDefinition`, `PlaybookRun`, `PlaybookStep`, `PlaybookDecision`, and `PlaybookReceipt`. Definition key/version, run idempotency key, composite tenant foreign keys, status/attempt checks, and decision/receipt history are persisted. PostgreSQL rejects UPDATE/DELETE of decisions and receipts. The nullable composite Case link detaches on Case deletion without clearing run tenant ownership. Existing migrations were not edited.

The implementation lives in `backend/src/playbooks/{playbook-policy,playbook.dto,playbook.service,playbook.controller,playbook.module}.ts`; `backend/src/app.module.ts` registers it. The analyst workspace is `frontend/app/threat-intelligence/playbooks/page.tsx` plus `frontend/components/intelligence/playbooks/PlaybookWorkspace.tsx`, using existing `frontend/app/editorial.css` tokens and the updated `frontend/DESIGN.md`. Sidebar and Threat Intelligence shell grant the workspace through the existing `indicator-management` feature. QA helpers are `backend/qa-phase3a-{fixture,server,corr-seed}.cjs`, the Playwright scenario `frontend/e2e/phase3a-playbook-browser.cjs`, and the policy/HTTP tests under `backend/src/playbooks/`.

## Playbook lifecycle

The first versioned definition is `malicious-domain-block-simulation` v1 with one `SIMULATED_DOMAIN_BLOCK` step. An authorized analyst triggers a run from an eligible, active, exact-match domain correlation alert. A linked case is copied from the alert when present; the alert and case are never mutated by playbook actions. The UI's eligible-alert endpoint filters tenant, domain type, matching value, IOC lifecycle eligibility, and RED TLP for regular users. Trigger rechecks eligibility to close the selection-to-action race. Case content is not included in the playbook response; a link opens the existing Case Management route, which enforces its own access.

The run moves through `PENDING_CONFIRMATION → PENDING_APPROVAL → APPROVED → EXECUTING → VERIFYING → VERIFIED`. An authorized analyst records confirmation and a reason. A **different** authorized analyst records approval and a reason. Rejection and expiry are explicit terminal states. Execution and verification are separate endpoints; attempts and receipts are retained. A timeout or failed verification moves the run to `FAILED`; one retry is available after an independently approved run, capped at two attempts. Idempotent trigger retries return the original run only for the same alert/case. Each transition writes an audit event.

The execution adapter is an in-process sandbox recorder: it computes a SHA-256 target digest and appends a `SIMULATED` receipt. It has no network client, connector credentials, firewall call, EDR call, cloud API, or endpoint-isolation path. Verification checks that receipt, target digest, and window; **VERIFIED means the sandbox receipt was verified, not that a domain was actually blocked**. Execution, verification, and retry require `SICTI_SOAR_QA_ENABLED=true`, `SICTI_ISOLATED_QA=true`, and a database named `cti_soar_qa_*`. They return unavailable otherwise. The UI displays the environment capability and disables execution controls when it is off.

## Security and validation

| Gate | Result |
|---|---|
| Prisma | Schema valid; 84 migrations, including two additive Phase 3A migrations, applied successfully to disposable SOAR QA and separate regression QA databases. |
| Backend unit/build | 29 Jest suites and 225 tests passed; Nest production build passed. Policy tests cover state ordering and QA execution gating. |
| Phase 3A PostgreSQL HTTP | Passed: unauthenticated and USER writes denied, foreign tenant hidden, idempotency, linked alert/case, separate approver, disabled-by-default execution, simulated receipt and verification, immutable receipt, RED run hidden from USER, audit rows, unchanged alert/case status, timeout and bounded retry, ineligible IOC removal from selector, and Case deletion detaching the link while preserving run tenant ownership. |
| Phase 1C correlation regression | Existing URLhaus IOC → synthetic telemetry → tenant-visible alert HTTP integration passed on `cti_corr_qa_*`. |
| Phase 2 regressions | Existing TTP observation and next-step PostgreSQL integrations passed **6/6** on `cti_phase2b_qa_*`, including tenant/TLP/cutoff/outcome cases. |
| Case Management regressions | Existing case investigation/campaign Node tests passed **21/21**. |
| Frontend | Type check and production build passed; new Playbooks route generated. |
| Authenticated Chrome E2E | Passed: initiator login → alert selection → run trigger → confirmation → second analyst login and approval → sandbox execution → receipt verification. A second pending run retained its own empty reason field. |
| Visual QA | Fresh independent function and fidelity reviews passed after fixes. Screenshots are [desktop](sicti-phase3a-desktop.png) (1365×1350) and [mobile](sicti-phase3a-mobile.png) (390×1700), captured from the real authenticated frontend against the isolated Auth/Correlation/Playbook API modules. |

The full `AppModule` QA server could not start against the shared local PostgreSQL instance because `cti` already held 93 of 100 available connections, and its many module-scoped Prisma pools exceeded the remaining slots. The browser scenario therefore ran the real compiled Auth, Correlation, and Playbook modules on an isolated QA API host, with the production-built frontend. This is an environment capacity limit, not a playbook execution failure; the full backend still compiled. No active `cti` database write occurred.

## Known limitations and Phase 3B recommendation

The eligible-alert selector searches the latest 100 correlations; older candidates need pagination. There is one deterministic domain action and one in-process receipt verification. No connector-side effect, remote verification, rollback, scheduling, queue worker, external timeout, or production readiness claim exists. A copied case link does not alter Case Management state. The mock target is an exact domain from an active IOC, not a general response policy engine. The Phase 3A local QA fixture password file was removed after screenshots; the disposable QA databases remain available for inspection.

**Recommended Phase 3B task:** design and validate an isolated sandbox connector contract with signed request/receipt correlation, explicit allowlists, bounded asynchronous retries/timeouts, independent connector-side verification, operator abort/rollback, and a fresh approval/security review before any real firewall, EDR, or cloud integration is considered. Phase 3B was not started. No commit, push, merge, or deployment was performed.
