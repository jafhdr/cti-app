# SICTI PR #7 — Phase 5E-D2 unified cross-module E2E closure

- **Date:** 24 November 2026 (Asia/Jakarta)
- **Repository / PR:** `jafhdr/cti-app` / Draft PR #7
- **Reviewed source:** `29d0eca04b0b57409128ff912aae4ccf8845a5cd`
- **Branch:** `integration/sicti-flagship-candidate`
**Verdict:** **SOAR APPROVAL CONTRACT SATISFIED — UNIFIED E2E READY FOR COMMIT REVIEW**

## Unified topology

One disposable PostgreSQL 16 container (`sict75-pg`) hosted one database, `cti_unified_qa_sict75`, on loopback port 55475. The same `DATABASE_URL` was used throughout. Prisma applied all **91/91** committed migrations with **0** rolled back, then the committed synthetic seed populated catalog and local QA identities.

One production backend build ran on `localhost:3001` and one production frontend build ran on `localhost:3000` from the reviewed worktree. Enabled flags were limited to isolated/unified QA, Correlation, SOAR simulation, Monitoring, and Case V2 UI support. The Correlation background worker was enabled only inside the focused harness. Telegram polling, notification delivery, Monitoring external collection, and all real external connectors/actions remained disabled. The SOAR connector was a signed loopback-only synthetic tool and accepted only `.test` targets.

The active `cti` database was never queried or modified. No database rename, production configuration change, commit, push, merge, deployment, or PR state transition occurred.

## Harness compatibility changes

A shared frontend E2E guard now accepts either each harness's unchanged historical database contract or `^cti_unified_qa_[a-z0-9]+$` when both `SICTI_ISOLATED_QA=true` and `SICTI_UNIFIED_QA_ENABLED=true` are present. AppSec's declared database must still equal `DATABASE_URL` on the historical path. Four positive/negative tests cover legacy acceptance, unified acceptance, missing flags, active/malformed names, and declaration mismatch.

The existing Correlation, Monitoring, shared-runtime, SOAR sandbox, and loopback mock preconditions received the same narrow unified alternative. Historical patterns, assertions, tenant checks, feature flags, signed connector policy, and production safeguards remain intact. `prepare-sict75-soar-fixture.cjs` converts the actual worker-generated Correlation state into the existing SOAR fixture contract; it does not synthesize a replacement Alert.

## Connected scenario results

### Scenario A — Threat Intelligence → Correlation → Case → SOAR: PASS

- Synthetic URLhaus observation and `.test` telemetry produced a worker-generated `CORRELATION` Alert.
- The Alert linked atomically to one active Case; concurrent replay converged, a conflicting second Case returned 409, and an induced post-create failure rolled back both Case and link.
- The same Alert and Case IDs were passed to the signed sandbox connector harness.
- Separate initiating and approving analysts confirmed/approved the run. Reader access returned 403 and foreign-tenant access returned 404.
- Sandbox block execution reached verified state, duplicate execution was idempotent, concurrent execution created one job, signed nonce replay was rejected, and safe rollback reached `ROLLED_BACK`.
- Persisted inspection showed the Alert still linked to the Case and multiple SOAR runs referencing that same Case, including `ROLLED_BACK` outcomes.

### Scenario B — Monitoring → ASM → Case: PASS

- A real QA ASM `DOMAIN` Asset was created first; the Monitoring watchlist persisted its `assetId` foreign key.
- Synthetic observation → matched finding → independent review → confirmed finding executed through authenticated HTTP.
- Two concurrent create-Case requests serialized on the finding row and converged on exactly one Case/link.
- Foreign finding and Case returned 404, reader returned 403, unauthenticated returned 401.
- Induced failure rolled back the Case, finding link, and audit writes.
- `OPEN` and `IN_PROGRESS` Case linking passed; new `RESOLVED` and `CLOSED` links returned HTTP 409 without link/audit mutation.

### Scenario C — AppSec → Case Management: PASS

- Real Chromium exercised the AppSec application/finding lifecycle against the live Nest backend and PostgreSQL without request interception.
- It created and edited an application and finding, linked an ASM asset and vulnerability, created a Case, verified idempotent Case creation, changed finding status, and checked posture persistence.
- Anonymous access returned 401; reader mutation returned 403; a user without AppSec access saw the denial surface; foreign-tenant list access returned 403 and foreign object access returned 404.
- A retained unified-view fixture linked an AppSec finding to the same Case used by Scenario A; persisted inspection confirmed the `AppSecFindingCase` tenant and Case foreign keys.

### Scenario D — authenticated frontend: PASS

Fresh headless Chromium logged in through the real application and captured Correlation, SOAR, Monitoring, ASM, AppSec, and Case views at 1280×900 and 390×844. All six modules rendered the shared tenant records: the worker Alert and linked Case, sandbox run history, ASM-linked Monitoring watchlist, ASM asset, and AppSec finding/Case link.

The 12 route captures plus one USER-role SOAR denial capture are in [`sict75-unified-e2e`](sict75-unified-e2e/). The browser ledger is [`browser-evidence.json`](sict75-unified-e2e/browser-evidence.json). Every route waited for its real shared record, removal of loading state, and stable document height before capture. Every route passed the document-overflow assertion; the mobile Case tab strip also passed a nested-overflow assertion. The final run recorded **0 HTTP failures and 0 console errors**. The USER session rendered settled playbook history but did not expose the “Create playbook run” action.

## Database and audit evidence

Post-run fresh-process inspection returned:

- migrations: `91 total / 91 finished / 0 rolled back`;
- shared Alert source `CORRELATION`, status `OPEN`, and `caseId` equal to the retained Case;
- SOAR runs on that Alert/Case including two `ROLLED_BACK` runs and the explicit abort-path run;
- Monitoring watchlist `assetId` equal to the retained ASM Asset;
- AppSec finding link `caseId` equal to the shared Case and the same tenant;
- 37 tenant audit rows and persisted Case activity.

Focused runtime assertions separately proved audit cardinality, immutable sandbox evidence, Case activity, idempotency, transaction rollback, concurrency locking, tenant scoping, and role denials.

## Build and security validation

- Backend production build: PASS.
- Frontend production build/type validation: PASS; 48 static pages generated.
- Unified full-runtime + Correlation/Case + Monitoring/ASM/Case: **3/3 PASS**.
- Connected worker-Correlation → SOAR sandbox: **1/1 PASS**.
- Live AppSec Chromium scenario: **1/1 PASS**.
- QA database guard: **4/4 PASS**.
- Changed CommonJS harnesses: `node --check` PASS.
- `git diff --check`: PASS (line-ending notices only).
- Existing five-job remote CI matrix was not rerun.

## Visual QA

The initial review correctly rejected premature SOAR/AppSec captures and a clipped mobile Case tab strip. The Case tabs were changed to a wrapped mobile layout and the browser harness now requires page-specific records, detached loading states, stable document height, and per-capture metrics. A second review identified clipped desktop ASM Actions and AppSec Updated columns; the affected tables now switch to their complete labelled-row layouts at the intermediate viewport. The entire 13-capture set was regenerated after the final production build and submitted to two new independent read-only reviewers; no historical capture was reused.

## Limitations

Both independent reviewers passed the final set of 13 captures. They confirmed visible ASM actions, AppSec Updated values, mobile Case tabs, and the read-only SOAR view.

- This is isolated local QA, not production readiness, external-provider certification, calibrated detection efficacy, deployment approval, or production rollback rehearsal.
- The retained AppSec unified-view record is synthetic; the separate live Chromium scenario proves the lifecycle and authorization behavior before its own fixture cleanup.
- The SOAR tool is intentionally loopback-only and synthetic. No real mitigation action was attempted.

## Exact changed files

QA guard and browser harness:

- `frontend/e2e/qa-database-guard.cjs`
- `frontend/e2e/qa-database-guard.test.cjs`
- `frontend/e2e/sict75-unified-browser.cjs`
- `frontend/e2e/asm-v2-p1a-live.spec.cjs`
- `frontend/e2e/asm-v2-p1b-live.spec.cjs`
- `frontend/e2e/asm-v2-p1c-live.spec.cjs`
- `frontend/e2e/asm-v2-p1d-live.spec.cjs`
- `frontend/e2e/appsec-p1a-live.spec.js`
- `frontend/e2e/appsec-p1b-live.spec.js`
- `frontend/e2e/appsec-p1c-live.spec.js`
- `frontend/e2e/appsec-p1d-live.spec.js`

Responsive UI correction found by visual QA:

- `frontend/app/globals.css`
- `frontend/app/editorial.css`
- `frontend/app/cases/[id]/page.tsx`

Connected backend harness:

- `backend/prepare-sict75-soar-fixture.cjs`
- `backend/qa-phase3b-mock-tool.cjs`
- `backend/src/unified-qa-runtime.integration.spec.cjs`
- `backend/src/correlation/correlation-case.http.integration.spec.cjs`
- `backend/src/intelligence/monitoring-case-concurrency.integration.spec.cjs`
- `backend/src/playbooks/sandbox-connector.integration.spec.cjs`

Report and evidence:

- `docs/audits/sicti-pr7-phase5e-unified-staging-e2e-closure.md`
- `docs/audits/sict75-unified-e2e/browser-evidence.json`
- 13 PNG files under `docs/audits/sict75-unified-e2e/`

## SICT76 focused approval closure

The original Phase 3A task (`sict11.md`, items 2 and 6) separates confirmation from approval and requires authorized approval before execution. The Phase 3B task (`sict12.md`, item 7) explicitly requires the “two-analyst confirmation and approval workflow” and its acceptance flow specifies “Analyst confirmation → Second analyst approval”. Phase 3C (`sict13.md`, item 5) preserves that contract. The [Phase 3A foundation report](sicti-phase3a-soar-foundation-report.md) specifies that a different authorized analyst approves.

`backend/src/playbooks/playbook-policy.ts` requires the CONFIRM and APPROVE transitions in sequence. `playbook.service.ts` scopes the decision lookup to the run's tenant, rejects both the trigger actor and confirmer as approver, and transactionally persists the decision `actorId` and audit `userId`. Its execution gate and the `sandbox-connector.service.ts` block gate require APPROVED. The retained HTTP acceptance assertions cover premature execution (409), self-approval (403), foreign tenant lookup (404), and audit row creation. The audit actor mapping was verified in code. The focused `playbook-policy.spec.ts` rerun passed 2/2. No database-backed suite was repeated.

The SICT75 harness changes preserve the historical QA paths and gate the new unified alternatives with isolated and unified flags. The Monitoring fixture adds an ASM foreign-key assertion. The three UI files change Case tab wrapping and extend the existing ASM/AppSec stacked layouts through 1350px. The retained browser ledger matches candidate HEAD and postdates the three UI edits and capture harness. Together with the final build and capture sequence this supports provenance, although the ledger contains no working-tree content hash. Other viewport widths were outside the retained capture set. `git diff --check` passed.

SICT76 changed only this closure report. The SICT75 file inventory and browser artifacts above remain intact.

## Final verdict

The SICT75 test listeners were stopped and the disposable PostgreSQL container and its anonymous data volume were removed. Temporary connector state, the runtime fixture, and the debugging journal were removed. Screenshots and the sanitized browser ledger are retained.

**SOAR APPROVAL CONTRACT SATISFIED — UNIFIED E2E READY FOR COMMIT REVIEW**

PR #7 remains Draft. Stop after local validation and reporting; no commit, push, merge, or deployment was performed.
