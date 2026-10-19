# CTI App

CTI App uses a Next.js frontend, NestJS API, PostgreSQL, and Prisma. It includes Authentication/RBAC, Tenant and Subscription management, Module Management and Feature Access, Threat Intelligence v1, Case Management, Attack Surface Management v1, Administration, and a dashboard. **AppSec Posture v1 is implemented; final closure audit is pending.**

## Development setup

Install Node.js, npm, and PostgreSQL. Create a development database (see [database setup](database/README.md)). The repository already contains Prisma migrations; do not create a new `init` migration.

From `backend`:

```bash
npm install
cp .env.example .env
# Set DATABASE_URL and replace the example JWT secrets in .env.
npx prisma generate
npx prisma migrate status
npx prisma migrate dev
npm run start:dev
```

For a deployment that only applies checked-in migrations, use `npx prisma migrate deploy` in place of `migrate dev`. The API defaults to `http://localhost:3001`; Swagger is at `/docs`. Seeding is optional: set `SEED_ADMIN_PASSWORD` privately before `npm run seed`.

In another terminal, from `frontend`:

```bash
npm install
cp .env.example .env.local
npm run dev
```

The frontend defaults to `http://localhost:3000`. On Windows PowerShell, `Copy-Item .env.example .env` (or `.env.local`) also works.

## Environment

`backend/.env.example` and `frontend/.env.example` define development variable names and defaults. Never commit local `.env` files or real credentials.

| Variables | Purpose |
| --- | --- |
| `DATABASE_URL`, `PORT`, `FRONTEND_URL` | PostgreSQL and API/frontend addresses |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Authentication signing secrets; replace example values |
| `SEED_ADMIN_PASSWORD` | Private initial password for optional seed |
| `NEXT_PUBLIC_API_URL` (frontend) | Browser-facing API URL |
| `URLHAUS_AUTH_KEY`, `MALWAREBAZAAR_AUTH_KEY`, `ABUSEIPDB_API_KEY` | Optional feed credentials |
| `VIRUSTOTAL_API_KEY`, `VIRUSTOTAL_*` | Optional enrichment key and worker settings |
| `THREAT_FEED_*`, `MITRE_ATTACK_SYNC_INTERVAL_MINUTES` | Feed limits and sync intervals |
| `TELEGRAM_*` | Optional Telegram ingestion and polling |
| `ASM_DISCOVERY_TIMEOUT_MS` | Discovery provider request deadline |

## Validation and tests

From `backend`:

```bash
npx prisma validate
npx prisma migrate status
npm run build
npm test -- --runInBand --no-cache
npm run test:integration
```

The integration script runs selected database-backed TI tests serially. It needs `backend/.env`, a reachable PostgreSQL database with applied migrations, and the backend build. The fixtures create and clean up QA rows; use a development database.

From `frontend`:

```bash
npm run build
npm run typecheck
npm run test:e2e
```

`test:e2e` runs the targeted Case/Indicator Playwright test. Start the frontend at `http://localhost:3000` first, and install Chromium with `npx playwright install chromium` if needed. The test mocks API calls but still needs the frontend server. Set `E2E_BASE_URL` for another frontend address. Other files under `frontend/e2e` can be run with `npx playwright test <file>` and may require live services or test data.

Final closure evidence: [ASM v1](docs/audits/auditasm2b-report.md), [Platform Hardening](docs/audits/cti2-report.md), [Threat Intelligence v1](docs/audits/ti1-report.md), and [Case Management v1](docs/audits/case-v1-report.md).
