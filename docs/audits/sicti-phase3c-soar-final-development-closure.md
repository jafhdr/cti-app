# SICTI Phase 3C — SOAR sandbox final development closure

**Date:** 2026-11-11\
**Verdict:** **SOAR SANDBOX DEVELOPMENT CLOSED**. This verdict covers the isolated synthetic `.test` sandbox only; it does not authorize or establish production mitigation readiness.

## Architecture and reliability

Phase 3C extends the [Phase 3B connector](sicti-phase3b-soar-sandbox-connector-report.md) within `.sicti-flagship-baseline`. The loopback mock now saves synthetic blocked-domain state, action request IDs, and consumed nonces in a versioned JSON store (`backend/qa-phase3c-mock-store.cjs`). The state file is restricted to `backend/.qa-phase3c-state`, written by atomic replacement with file sync, and protected by a single-process lock. A mock restart reloads blocked state and replay history. Retrying an action with its original request ID returns the recorded result; reusing that ID for a different tenant, target, or operation is rejected. Each duplicate response receives a fresh signed timestamp. The `delay-once` fault mode applies the synthetic action before delaying the response, exercising timeout recovery after a side effect.

The database-backed connector worker continues to reclaim expired leases and retry a durable request ID. A restart/timeout integration test confirms that the same request ID resolves to one stored tool action and a subsequent independent state query verifies its effect. No new Prisma model or migration was needed.

For terminal `ROLLBACK_FAILED`, `POST /playbooks/runs/:id/sandbox/recover-rollback` accepts a reason and idempotency key from an authenticated tenant ADMIN or SUPER_ADMIN. The service checks the original independent two-analyst approval, tenant, synthetic target, failed rollback job, and QA gate. In one transaction it resets that job with a **new** action request ID, records the operator and prior failure in an immutable `RECOVERY_QUEUED` event, and writes an audit log. Duplicate recovery keys return the prior result. Recovery is limited to two operator cycles, each with the worker's bounded attempts; success still requires an independent signed tool-state read confirming the domain is unblocked. The Playbook workspace exposes the reason and retry action only for eligible failed runs, displays the event history, and explains the terminal limit.

## Verification

| Check | Result |
| --- | --- |
| Prisma | Schema valid; **86 migrations**; disposable `cti_soar_qa_20261110133159` schema up to date. No Phase 3C migration. |
| Builds and unit/security suite | Backend Nest build, frontend TypeScript check, and production Next build passed. Jest **31 suites / 237 tests** passed. |
| Persistent mock | `backend/qa-phase3c-mock-persistence.spec.cjs` **2/2**: restart persistence, nonce rejection, request-ID idempotency/conflict, restoration, and state-file path guard. |
| PostgreSQL connector and recovery | `sandbox-connector.integration.spec.cjs` and `sandbox-recovery.integration.spec.cjs` **2/2**: approval, signed verification, worker/mock restarts, delayed side effect, replay, authorization, bounded terminal failure, idempotent operator recovery, tenant isolation, and immutable events. |
| Full module | `backend/qa-phase3c-full-app.spec.cjs` passed with `AppModule` on the disposable QA database, `connection_limit=1`, background integrations disabled; authenticated Playbook capabilities and runs returned HTTP 200. |
| Existing feature regressions | Phase 3A **1/1**, Phase 1C **1/1**, Phase 2 **6/6** with fresh synthetic fixture, Case Management **31/31**. |
| Authenticated Chrome | `backend/qa-phase3c-browser.ps1` passed: two analysts approve a block; signed state confirms it remains blocked after mock restart; rollback restores state; a second run reaches terminal rollback failure, then operator recovery records and verifies restoration. [Execution evidence](sicti-phase3c-browser-evidence.json). |
| Visual QA | Desktop and 390px mobile screenshots inspected; functional and design-fidelity reviews passed without a blocker. `git diff --check` passed. |

Screenshots: [verified block](sicti-phase3c-block-verified-desktop.png), [first restored desktop](sicti-phase3c-restored-desktop.png), [first restored mobile](sicti-phase3c-restored-mobile.png), [terminal failure](sicti-phase3c-recovery-failed-desktop.png), [operator restored desktop](sicti-phase3c-recovery-restored-desktop.png), and [operator restored mobile](sicti-phase3c-recovery-restored-mobile.png). Reviewer notes are in `.omo/evidence/sicti-phase3c-manual-qa.md` and `.omo/evidence/phase3c-soar-clone-fidelity.md`.

## Security and operational review

- **Authentication and replay:** HMAC-SHA256 authenticates both request and response. Version, action, tenant, target, unique request ID, nonce, and timestamp are checked. The mock rejects consumed nonces across restarts and requests outside the 30-second window; the client checks response identity and freshness. Its secret comes from the process environment and is absent from the persisted state and audit evidence.
- **Scope and authorization:** Execution requires `SICTI_SOAR_QA_ENABLED`, `SICTI_ISOLATED_QA`, a `cti_soar_qa_*` database, an adequate secret, and a loopback URL. Only synthetic `.test` domains and explicit block/unblock actions are accepted. Tenant and module guards, ADMIN/SUPER_ADMIN recovery roles, two distinct analyst decisions, TLP visibility, and immutable event history remain enforced. The active `cti` database was not used.
- **Failure states:** Bounded worker attempts and lease recovery avoid indefinite in-flight jobs. A failed rollback becomes visible and requires a reasoned operator action. Up to two recovery cycles are allowed; failed or unavailable tool state cannot be reported as restored. Idempotent tool actions prevent duplicate synthetic effects after timeouts and restarts.
- **Local store safeguards:** A fixed local directory, simple filename validation, symlink rejection, process lock, atomic replacement, and a 4 MB/10,000-nonce capacity bound reduce accidental corruption and unbounded growth. Capacity exhaustion fails closed. The store is an isolated QA fixture, not a production durable store or high-availability design.

## Limits and production connector requirements

The mock state file is local and single-writer. It does not provide distributed consensus, encrypted durable storage, backup/restore, retention rotation, or resilience against host loss and manual file tampering. Its PID-based lock can require operator attention after abnormal termination or PID reuse. Status is polled; callback delivery is not implemented. Signed synthetic state proves the mock's reported state at verification time, not real firewall or endpoint effectiveness.

Before any production adapter, define a tool-specific least-privilege credential and rotation scheme, authenticated transport and endpoint allowlists, durable shared idempotency/replay storage, cross-instance locking, bounded retention, explicit rate limits and kill switch, production audit/alert routing, vendor error taxonomy, human approval and rollback runbooks, independent effect verification, and staged integration testing with failure injection. Firewall, EDR, SIEM, and cloud adapters remain unimplemented and disabled.

## Next phase recommendation

Start **Dark Web & Brand Monitoring Phase 4A** with a scoped design and evidence foundation: authorized collection sources, brand/entity matching, provenance and TLP handling, deduplication, tenant boundaries, and analyst review criteria. No Phase 4 implementation was started here.
