# PR #7 Phase 5A — GitHub Actions CI implementation

**Date:** 2026-11-17 (Asia/Jakarta)\
**Candidate:** `integration/sicti-flagship-candidate` at `797cbb9669c24b9f9cfbf70c93e04cfa90f9d8a6`, plus its existing uncommitted Phase 1–4B work.\
**Verdict:** **CI IMPLEMENTATION READY FOR COMMIT REVIEW.** The workflow and local checks are ready for review. This is not a claim that GitHub CI has passed; Draft PR #7 has not been updated and no remote run exists.

## Scope and baseline preservation

The pre-edit [inventory](sicti-pr7-ci-prechange-inventory.csv) records status, byte length, and SHA-256 for 224 modified or untracked files. It includes 30 application/harness files, 81 UX44 evidence files, 21 UX45 evidence files, 22 unified stateful files, seven cross-feature files, ten local QA state files, and other accepted reports/logs. Existing contents were preserved. Phase 5A adds only [.github/workflows/sicti-ci.yml](../../.github/workflows/sicti-ci.yml), this report, and the inventory. No application business logic, Prisma migration, other worktree, staging area, commit, remote branch, or PR state was changed.

The repository has separate `backend/package-lock.json` and `frontend/package-lock.json`, Nest/Prisma backend scripts, Next frontend scripts, 35 Jest suites, and Node `--test` integration harnesses. There is no project `.nvmrc`; CI explicitly uses Node 22. PostgreSQL 16 service containers provide isolated disposable databases. The CI workflow uses `pull_request` targeting `main`, repository contents read permission only, checkout without persistent credentials, no repository or cloud secrets, and no `pull_request_target` event. npm caches are disabled for the untrusted PR path. Failures are not suppressed.

## Jobs and exact check names

| GitHub job/check name | Required work |
| --- | --- |
| `Backend build and unit tests` | `npm ci`, Prisma schema validation and client generation, Nest build, all Jest unit suites. |
| `Frontend typecheck and build` | `npm ci`, TypeScript typecheck, Next production build with a synthetic localhost API URL. |
| `Migrations and core regressions` | Fresh PostgreSQL `cti_corr_qa_sict40`, migration deploy twice, migration status, synthetic module seed, authenticated access/RBAC/tenant, Correlation, Correlation–Case, and Case allocator HTTP/concurrency tests. |
| `Monitoring Case atomicity` | Fresh PostgreSQL `cti_phase4a_qa_sict36ci`, migration deploy, synthetic Monitoring finding/Case concurrency regression. |

The two database names satisfy the existing exact QA database guards. Each job gets a separate service container. The shared CI passwords and JWT secrets are synthetic constants scoped to the disposable runner; the integration harnesses create random test users and tenants. `SICTI_ISOLATED_QA=true` is set only in database jobs. Monitoring provider collection, SOAR simulation/actuation, Telegram polling, and automatic Correlation worker scheduling are disabled by default. The selected tests may toggle the in-process Correlation worker to test a synthetic event; no external connector is configured.

**Execution prerequisites:** the workflow and all currently untracked accepted integration harnesses it names must be committed together; GitHub hosted Ubuntu runners must support Docker service containers and the selected Node/Actions versions; npm registry and the PostgreSQL image registry must be reachable. Repository branch protection can then require the four check names above. No branch-protection setting was changed here.

## Harness selection and limits

The selected `access.integration.spec.cjs` tests authenticated backend access and tenant boundaries without its optional browser branch (`ACCESS_BROWSER_QA=0`). `correlation.http`, `correlation.security`, `correlation-case.http`, `case-number-concurrency`, and `case-number-workflows` use the guarded Correlation database. `monitoring-case-concurrency` uses its separate guarded Phase 4A database and builds its own fixture.

The broader `auth.security.integration.spec.cjs` requires a running frontend and Playwright browser; it is not included. The older `monitoring.http` and collector harnesses require the exact `cti_phase4a_qa_20261111` name plus an untracked `.omo/evidence/sicti-phase4a-qa-fixture.json` absent from this candidate. The Correlation–SOAR HTTP harness requires `cti_soar_qa_*`, a local `qa-sict39-state.json`, and a sandbox setup. These are excluded rather than weakening production guards or importing local state into CI. The selected Monitoring–Case and Correlation–Case tests cover the requested linkage regressions; full provider and browser matrices remain outside Phase 5A.

## Local validation and remote status

- Workflow YAML parsed locally; `pull_request`/`main`, read-only permissions, all four jobs, and absence of `continue-on-error` were checked. Every named test path exists in the candidate.
- `npx prisma validate` passed against a synthetic localhost URL; it did not connect to a database.
- `npm test -- --runInBand --silent` passed: **35/35 suites, 261/261 tests**. `git diff --check` passed, with only existing LF/CRLF conversion warnings.
- Frontend typecheck and production build passed in Phase 4B after the most recent application edit; they were not rerun for this workflow-only change. The database jobs, GitHub Actions expression evaluation, Linux Node 22 build, and remote check statuses remain **unverified until the workflow is committed and run on the PR head**.

## QA evidence publication recommendation

For an eventual PR update, include concise sanitized reports and assertions: the [final code/security review](sicti-pr7-final-code-security-review.md), [Case allocator remediation](sicti-pr7-case-number-allocator-remediation.md), [Correlation–Case integration](sicti-pr7-correlation-alert-case-integration.md), [Phase 4B UX reconciliation](sicti-pr7-frontend-ux-reconciliation-implementation.md), [UX45 browser assertions](sicti-pr7-ux45/browser-evidence.json), and [UX45 Correlation assertions](sicti-pr7-ux45/correlation-evidence.json). Select representative populated ASM/Monitoring, mobile, Campaign, and Correlation screenshots from `sicti-pr7-ux45/`; avoid publishing all 131 existing untracked images without a reviewer need. Inspect any report/log before publication for local connection strings, cookies, bearer tokens, passwords, and synthetic identifiers. Do not publish `backend/.qa-phase3c-state/` or `backend/qa-sict39-state.json`; those local state files are not CI fixtures. Raw staging/stateful logs and duplicate screenshots should remain local unless sanitized and specifically needed.

## ASM discovery-history error triage

The Phase 4B ASM screenshot shows `Could not load discovery history.` The frontend `DiscoverySchedule` requests three endpoints (`schedule`, `runs`, `changes`) together and emits that one message if any returns a non-2xx response. The backend registers those routes, but `DiscoveryRunsController` additionally requires the `asset-discovery` feature. The populated ASM asset, port, and vulnerability endpoints work under different permissions. A missing `asset-discovery` assignment or entitlement in the disposable sict45 fixture is therefore the leading explanation, not a demonstrated application defect. The sict45 fixture and server logs were intentionally deleted after its disposable database was dropped, and the browser record did not retain the three HTTP statuses, so this classification is **probable, not confirmed**. A follow-up isolated fixture should explicitly grant `asset-discovery`, record all three responses, and only then classify any remaining 5xx/incorrect 4xx as an application defect. No application remediation was made here.

## Remaining blockers

The workflow cannot report green remotely until the accepted untracked harnesses and this workflow are committed together and GitHub executes the four jobs. Exact Linux/Node 22 behavior and the ASM history endpoint classification remain unverified. No active `cti` database, real connector, deployment, or Draft PR #7 update was involved.
