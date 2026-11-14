# ASM V2 isolated QA runbook

This runbook describes the current development harness. Use a disposable PostgreSQL database, synthetic tenants/accounts, real NestJS and Next.js services for live browser checks, and normal SICTI login. It is not a one-command CI runner or production rollout procedure.

## Prerequisites and database boundary

- Install backend and frontend dependencies from their respective lockfiles (`npm ci` in `backend` and `frontend`). Both use Node.js; neither package declares a pinned `engines` version. The accepted local run used Node 24. Verify builds on the intended runner rather than assuming other versions are supported.
- Provide PostgreSQL, backend Prisma CLI/Client, and Playwright Chromium for live browser checks. Supply database credentials and fresh QA-only authentication secrets through a secure local process environment; do not put them in source control or this document.
- Create an **empty, isolated database** and verify its exact identity before `prisma migrate deploy`, `prisma generate` or `npm run db:seed`. Never point automated QA setup at an active `cti` database. Confirm all **70 source migrations** finished on the disposable database before connected tests. Stop if the expected QA name already exists or belongs to another run. Do not substitute an active database to satisfy a test guard. The seed requires a fresh QA-only `SEED_ADMIN_PASSWORD` supplied securely through the process environment.
- The current test files hard-code QA database-name guards. P1-A backend accepts `cti_asm59_qa_` through `cti_asm62_qa_` prefixes; P1-B backend accepts 60/61/62; P1-C backend accepts 61/62. P1-D backend and browser require exactly `cti_asm62_qa_20261029_0930`; P1-B browser requires exactly `cti_asm60_qa_20261028_1935`; P1-C browser requires exactly `cti_asm61_qa_20261028_2145`; P1-A browser accepts 59/60 prefixes. Treat those names as **test guard constraints**, not reusable shared databases. A fresh isolated environment is needed if a fixed name is occupied. No generic configurable database name is implemented in those scripts.

Use only QA-scoped credentials, tenants and accounts. Keep external providers/workers off. Check ports **3200** (Next.js) and **3201** (NestJS) before launching live browser checks; the scripts use these literal origins. Do not stop an existing service just to reuse a port.

Before any migration or seed, inspect the configured database name without displaying the credential-bearing URL. For a PowerShell runner, this local guard is a useful additional check; also verify the database identity from PostgreSQL itself:

```powershell
if (-not $env:DATABASE_URL) { throw 'QA database URL is missing' }
$qaDbName = ([uri]$env:DATABASE_URL).AbsolutePath.TrimStart('/')
if ($qaDbName -eq 'cti' -or $qaDbName -notmatch '^cti_asm(59|60|61|62)_qa_') { throw 'Refusing non-ASM-QA database' }
```

The test file's stricter guard must also match the selected name. Never use this prefix check as permission to overwrite an existing database.

## Gates and authorization

The actual backend rollout flags are `ASM_V2_EVIDENCE_ENABLED`, `ASM_V2_REVIEW_ENABLED`, `ASM_V2_PRIORITY_ENABLED` and `ASM_V2_OPERATIONS_ENABLED`. The frontend visibility flags present in source are `NEXT_PUBLIC_ASM_V2_REVIEW_ENABLED`, `NEXT_PUBLIC_ASM_V2_PRIORITY_ENABLED` and `NEXT_PUBLIC_ASM_V2_OPERATIONS_ENABLED`; there is no separate `NEXT_PUBLIC_ASM_V2_EVIDENCE_ENABLED` flag. Evidence presentation depends on tenant enrollment and API state. All V2 backend gates default OFF unless explicitly set to `true` in the QA process. Tenant enrollment is separate and starts disabled. Frontend visibility never grants backend permission. For browser QA, build Next.js with the needed `NEXT_PUBLIC_*` flags and `NEXT_PUBLIC_API_URL=http://localhost:3201`; start it on port 3200. Start the QA NestJS process with `PORT=3201`, `FRONTEND_URL=http://localhost:3200`, QA database URL and required backend gates. Do not edit an active `.env` to do this.

Review mutation requires effective ASM module access and `asset-correlation-review`; reading evidence/priority/reporting has its own server checks. Test ADMIN, granted USER reviewer, ungranted USER, foreign Tenant B and SUPER_ADMIN with an explicitly selected tenant. Preserve V1 Finding/Alert state and TI/AppSec/Case lifecycle during these tests.

## Existing commands

Run commands from the named package directory. Install and validate on the isolated QA database:

```text
backend:  npm ci
backend:  npx prisma migrate deploy
backend:  npx prisma generate
backend:  npm run db:seed
backend:  npm run build
frontend: npm ci
frontend: npm run typecheck
frontend: npm run build
frontend: npm run start -- -p 3200
```

`backend/package.json` contains `build` and `db:seed`; `frontend/package.json` contains `typecheck`, `build`, `start` and `test:asm-v2:p1b`. The backend `test:integration` script targets unrelated TI suites, and the frontend generic `test:e2e` targets a Case suite. There is no single ASM V2 runner.

With the isolated QA database selected and the backend build present, run the connected Node tests **serially** from `backend`:

```text
node --test --test-concurrency=1 src/attack-surface-management/asm-v2-p1a.integration.spec.cjs src/attack-surface-management/asm-v2-p1a.http.spec.cjs src/attack-surface-management/asm-v2-p1b.http.spec.cjs src/attack-surface-management/asm-v2-p1c.http.spec.cjs src/attack-surface-management/asm-v2-p1d.http.spec.cjs
```

Each file enforces its own database-name guard; run only a compatible subset on the selected fresh database. In particular, the accepted connected P1-D run used the P1-D fixed QA name. The tests create a real Nest HTTP instance and synthetic PostgreSQL records, then clean their own tenants. P1-A covers evidence/refresh and V1 boundaries; P1-B covers decisions, grants, audit and concurrency; P1-C covers priority; P1-D covers operations and count consistency. Unit fixtures can be run from `backend` with the existing Jest CLI, for example `npx jest --runInBand src/attack-surface-management/correlation-evidence.spec.ts src/attack-surface-management/priority-evaluator.spec.ts`. Relevant ASM V1, TI/AppSec/Case regression files are separate and should be selected by their actual paths and isolation requirements.

For authenticated browser journeys, run one matching script at a time from `frontend`, after its QA database, seed, backend and correctly flagged Next.js build are ready:

```text
node e2e/asm-v2-p1a-live.spec.cjs
npm run test:asm-v2:p1b
node e2e/asm-v2-p1c-live.spec.cjs
node e2e/asm-v2-p1d-live.spec.cjs
```

These are **separate** journeys with different database-name guards; the list is not a sequential command block for one database. They use real login, real Next/Nest endpoints and PostgreSQL, not mocked authentication or evidence APIs. If the browser binary is absent, install Chromium using the Playwright tooling already in `frontend` before running a journey.

## Private screenshots and cleanup

`SICTI_ASM_E2E_EVIDENCE_DIR` sets the browser screenshot output directory. If unset, `frontend/e2e/asm-v2-evidence-path.cjs` uses a private directory under the OS user's home. The helper rejects paths that resolve inside the ASM worktree, including through existing links, and creates the directory when a screenshot is needed. Keep screenshots and private audit data outside Git. This variable controls **QA evidence output only**, not application rollout. A platform-independent example is to set it to a private directory selected by the local test runner outside its repository checkout.

After a run, confirm the test-created tenant/account cleanup and stop **only** QA services started for that run. Verify the exact disposable database identity and that no QA connections remain before an operator removes that **specific** QA database through the local database administration procedure. Never delete by prefix or wildcard and never delete an unverified or active database. Confirm the active environment and unrelated workspaces were untouched. Do not commit screenshots, `.env`, tokens, dumps or private audit reports.
