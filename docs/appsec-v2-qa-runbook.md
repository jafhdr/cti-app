# AppSec V2 isolated QA runbook

This runbook reproduces development checks against a disposable PostgreSQL database. It does not authorize use of an active tenant database, production providers, or rollout. Commands below assume PowerShell at the repository root; supply connection credentials through a secure local process environment. Never commit a `.env` file, database dump, token, or screenshot.

## Prerequisites and isolation

- Use the repository's separate `backend/package-lock.json` and `frontend/package-lock.json` with `npm ci` in each directory. No package `engines` field pins Node; the last local acceptance used Node 24 and npm 11. Confirm the project builds on the intended runner rather than assuming another version is supported.
- Provide PostgreSQL and the Prisma CLI/Client from backend dependencies. Install cached Chromium or run `npx playwright install chromium` in `frontend` if absent.
- Select **one** suite and a fresh database name matching its guard: P1-A `stake45_p1a_<10 lowercase hex>` / `APPSEC_P1A_QA_DB_NAME`; P1-B `stake46_p1b_<10 hex>` / `APPSEC_P1B_QA_DB_NAME`; P1-C `stake47_p1c_<10 hex>` / `APPSEC_P1C_QA_DB_NAME`; P1-D `stake48_p1d_<10 hex>` / `APPSEC_P1D_QA_DB_NAME`; connected closure `stake49_closure_<10 hex>` / `APPSEC_CLOSURE_QA_DB_NAME`. Use a new random suffix every run. The guard also requires the `DATABASE_URL` pathname to match that exact name. None of these patterns is an existing database identity.
- Check ports 3100 and 3101 before a live suite: `Get-NetTCPConnection -State Listen -LocalPort 3100,3101 -ErrorAction SilentlyContinue`. Stop or choose a separate QA environment if occupied. Live tests bind their embedded Nest backend to **3101** and expect a separately started real Next.js frontend on **3100**. They are not designed for parallel live-suite execution. Ports 3000/3001 and active app services should be avoided in this QA run.
- Use only QA scoped environment variables. Set `TELEGRAM_POLL_ENABLED=false`, `NOTIFICATION_WORKER_ENABLED=false`, leave provider credentials empty, and do not launch the full scheduled-worker application for these focused suites. The live tests start only the Nest modules they need; no external feed, Telegram, VirusTotal, SMTP, notification or production provider should be configured. Keep outbound traffic confined to local QA and the browser installation step if needed.

## Prepare one disposable database

From a shell with PostgreSQL credentials available securely (for example through `PGPASSWORD` or a local password manager), set a fresh QA name and its connection URL. Do not paste a credential-bearing URL into terminal history or a tracked file. Verify both values before any migration:

```powershell
$qaName = 'stake48_p1d_' + [guid]::NewGuid().ToString('N').Substring(0,10)
$env:APPSEC_P1D_QA_DB_NAME = $qaName
# Supply DATABASE_URL, QA_POSTGRES_USER and PostgreSQL authentication securely.
if (-not $env:DATABASE_URL -or -not $env:QA_POSTGRES_USER) { throw 'QA connection inputs missing' }
$qaUrl = [uri]$env:DATABASE_URL
if ($qaUrl.AbsolutePath -ne "/$qaName") { throw 'QA database mismatch' }
createdb -h $qaUrl.Host -p $qaUrl.Port -U $env:QA_POSTGRES_USER $qaName
if ($LASTEXITCODE -ne 0) { throw 'QA database creation failed' }
psql -h $qaUrl.Host -p $qaUrl.Port -U $env:QA_POSTGRES_USER -d postgres -At -c "SELECT datname FROM pg_database WHERE datname = '$qaName'"
```

Set the QA user and connection URL locally without printing them. Confirm that the catalog query returns the exact QA name; if any command fails, stop and do not fall back to `cti`. For another suite, use its own prefix and environment variable. Create the QA database exactly once, then from `backend`, with `SEED_ADMIN_PASSWORD` supplied securely as a fresh random QA value:

```powershell
npm ci
npx prisma migrate deploy
npx prisma generate
npm run db:seed
npm run build
```

`db:seed` provides the normal module catalog in QA. The focused tests create their own synthetic tenants, users, entitlements and Findings. Do not seed or grant features in an active database. The disposable database must contain all tracked migrations before a live suite; P1-D and connected closure expect the final 68-migration schema.

## Backend integration checks

With the QA `DATABASE_URL` still set, run tests from `backend` **serially** to avoid shared-fixture conflicts. The focused tests create a real Nest HTTP server on an ephemeral localhost port and use PostgreSQL. They import `backend/dist`, so build first. Example:

```powershell
node --test --test-concurrency=1 src/appsec/appsec.p1a.integration.spec.cjs
node --test --test-concurrency=1 src/appsec/appsec.p1b.integration.spec.cjs
node --test --test-concurrency=1 src/appsec/appsec.p1c.integration.spec.cjs
node --test --test-concurrency=1 src/appsec/appsec.p1d.integration.spec.cjs
```

The connected test requires `APPSEC_CLOSURE_QA_DB_NAME` and a matching `stake49_closure_...` database. On a Node runner that blocks subprocess isolation, `node --test --test-isolation=none src/appsec/appsec.v2-closure.integration.spec.cjs` is supported; the ordinary `node --test` form works where process spawning is allowed. The integration tests set and restore their test-scoped JWT access secret and required backend flags. Run the connected test on its own QA database after catalog seeding.

## Authenticated Playwright checks

The `frontend/e2e/appsec-p1a.spec.ts` fixture-based UI test intercepts backend responses. It checks UI controls and responsive behavior, not real login or PostgreSQL. The `appsec-p1a-live.spec.js` through `appsec-p1d-live.spec.js` suites use normal login with synthetic QA users and a real PostgreSQL-backed Nest instance; they do **not** mock authentication or AppSec lifecycle routes.

For each live suite, choose its matching QA-name guard, keep the database and backend build from preparation, and set backend QA flags only in the test process: `APPSEC_V2_TRIAGE_ENABLED=true` for P1-A; add `APPSEC_V2_REMEDIATION_ENABLED=true` for P1-B; add `APPSEC_V2_VERIFICATION_ENABLED=true` for P1-C; P1-D exercises reporting with the completed schema. The frontend bundle needs `NEXT_PUBLIC_API_URL=http://localhost:3101` and matching `NEXT_PUBLIC_APPSEC_V2_TRIAGE_ENABLED`, `NEXT_PUBLIC_APPSEC_V2_REMEDIATION_ENABLED`, `NEXT_PUBLIC_APPSEC_V2_VERIFICATION_ENABLED` values **at build time** for the controls under test. Keep all unset except those required by the selected suite. Set `FRONTEND_URL=http://localhost:3100` for the backend test process when applicable. Provide random QA `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values through the local process environment; do not write them in this runbook or source control.

From `frontend`, with those QA-only variables set:

```powershell
npm ci
npx playwright install chromium  # only if the browser is not already installed
npm run build
npm run start -- -p 3100      # leave this QA frontend running in its own terminal
```

In a second terminal, retain the same QA `DATABASE_URL` and backend/test variables, confirm port 3101 is free, then run **one** live suite:

```powershell
npx playwright test e2e/appsec-p1d-live.spec.js --workers=1
```

Replace the spec with the selected P1-A/B/C path and its matching QA guard and flags. Do not start a separate Nest server on 3101: the live test creates and closes it. The frontend's compiled API URL must point to 3101. The P1-A fixture test can be run separately with `npx playwright test e2e/appsec-p1a.spec.ts --workers=1` against the QA frontend; its `SIDEBAR_APP_URL` defaults to 3100. The project's generic `npm run test:e2e` runs a Case test, not these AppSec suites.

The access and tenant-user browser regressions use their own harnesses. Their original defaults remain frontend 3000 and API 3001; for isolated 3100/3101 QA set `ACCESS_FRONTEND_URL`, `ACCESS_API_URL`, and `TENANT_SECURITY_FRONTEND_URL` to the QA origins as appropriate, and follow those test files' browser enablement and JWT prerequisites. Their full run is separate from the four AppSec live suites.

## Results and cleanup

Review terminal results and `frontend/test-results/appsec-p1*-live/` screenshots locally. Those images may contain synthetic QA data and are **not** checkpoint candidates. Stop only the frontend process started for this run, confirm 3100/3101 have no QA listeners, and disconnect test processes. Before deletion, query `pg_database` for the exact generated name and confirm it is neither `cti` nor any other shared database. Then run `dropdb -h $qaUrl.Host -p $qaUrl.Port -U $env:QA_POSTGRES_USER $qaName` and query again to confirm the QA name is absent while `cti` remains. Never delete by prefix/wildcard, and never delete an unverified database. Clear QA-only environment variables when finished.

This runbook documents the current test harness. Its fixed QA ports, manual frontend lifecycle, database creation/cleanup and build-time frontend flags are prerequisites; they are not yet a one-command CI workflow. Development closure does not imply production activation.
