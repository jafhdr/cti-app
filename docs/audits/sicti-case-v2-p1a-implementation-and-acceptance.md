# SICTI Case Management V2 P1-A — implementation and isolated acceptance

Date: 30 October 2026 (Asia/Jakarta). **Verdict: CASE MANAGEMENT V2 P1-A DEVELOPMENT PASS WITH DOCUMENTED LIMITATIONS.** This is development acceptance only. No active database migration, flag activation, commit, push, merge or deployment occurred.

## Baseline and isolation

The isolated worktree `.case-v2-worktree` is detached at approved `5d06bfcd66f9d7831a65f8d701db31c343bdeff1`. The original dirty workspace and existing worktrees remain source-unchanged. The disposable PostgreSQL database is `cti_case_v2_qa_20261030`; the active `cti` database was not migrated. Temporary localhost servers were stopped after browser QA. The QA process alone set `CASE_V2_ORIGIN_ENABLED=true`; the browser run used it `false`.

## Implemented files

| Area | Files and behavior |
|---|---|
| Schema/migration | `backend/prisma/schema.prisma`; `backend/prisma/migrations/20261102100000_case_v2_p1a_origin/migration.sql`; `20261102110000_case_v2_p1a_legacy_reuse/migration.sql`. Add CaseOrigin and CaseCreateRequest. Origin is one per Case, tenant-composite, DB immutable, and prevents Case hard delete. Idempotency request rows cascade when a reused legacy Case is deleted, preserving V1 behavior. |
| API | `backend/src/cases/case-v2.types.ts`, `cases-v2.controller.ts`, `cases-v2.service.ts`, `cases.module.ts`. Add authenticated `POST /cases/v2` and `GET /cases/:id/origin`; five origins, source/tenant checks, safe versioned snapshot, replay and source reuse, default-off environment gate plus feature entitlement. |
| Compatibility | `backend/src/cases/cases.service.ts` rejects legacy DELETE for V2-origin Cases; V1 Cases without origin remain deletable. `backend/prisma/seed.ts` registers `case-v2-origin`; no active assignment/activation was made. |
| QA | `backend/qa-case-v2-p1a.cjs`, `frontend/qa-case-v2-browser.cjs`; focused V1 fake in `backend/src/cases/cases.investigation.spec.cjs`; existing ASM test fixture updated for its required `suppressionKind` field. |

The first migration applied after the existing 70 baseline migrations. The second is a corrective additive FK migration found during QA: a reused legacy Case must remain deletable. On a clean database, both run in order.

## Acceptance evidence

- `prisma validate` PASS; `prisma migrate deploy` applied all 72 migrations to the isolated database; `prisma migrate status` reported up to date after the initial 71 and the corrective migration then applied successfully. `prisma generate` PASS; backend `npm run build` PASS; frontend `npm run typecheck` PASS.
- Real NestJS HTTP with normal `/auth/login` cookies and Prisma database assertions: five origin types created; ADMIN creation, USER denial, SUPER_ADMIN selected-tenant requirement, A/B foreign resource concealment, missing source and Case/ASM feature denial, same-key replay and changed-payload 409, six concurrent identical retries converging on one Case/request, three concurrent distinct keys creating three Cases, ASM Alert and AppSec Finding reuse, pre-existing V1 Case reuse with request records but no fabricated origin, and `LEGACY_UNKNOWN` projection. Latest successful synthetic run: tenant A `cmvuq028u0000gpk0thvz10c6`, tenant B `cmvuq02eg000vgpk07mvvi0iw`.
- PostgreSQL assertions: one origin per new Case; duplicate request count one; immutable origin UPDATE/DELETE rejected; direct Case DELETE with V2 origin rejected; V1 DELETE of reused legacy Case succeeded and its idempotency records cascaded; source status change left the historical snapshot intact and removed navigation; an induced CaseOrigin insert failure rolled back the ASM Finding Alert bridge and idempotency row. TI Indicator, ASM Alert and AppSec Finding lifecycle states remained unchanged by successful Case creation. Default-off gate returned 403.
- V1 Case node tests: **56/56 PASS** (lifecycle, investigation, Indicator, Threat Actor and Campaign paths). Backend Jest: **205/205 PASS, 23/23 suites** after correcting the pre-existing ASM fixture type mismatch.
- Authenticated Chrome/Playwright Case list acceptance: **PASS** at 1280, 768 and 375 pixels with QA backend and synthetic tenant admin. Screenshots: `case-v2-p1a-browser-1280.png`, `case-v2-p1a-browser-768.png`, `case-v2-p1a-browser-375.png`. The desktop and mobile screenshots were visually inspected; no clipping or access error was observed. The existing UI was not altered to expose V2 origin controls.

## Limits and rollout boundary

- P1-A is backend/schema capability. The V2 creation/origin API has no new frontend control. Legacy Case screens and workflows remain available; V2 rollout remains default off.
- Historical V1 Cases have no inferred origin. A legacy Case reused from ASM/AppSec stays `LEGACY_UNKNOWN` unless it already has genuine V2 provenance.
- CaseOrigin immutability also blocks tenant hard deletion while origin rows exist. Tenant retention/export policy is deferred to P1-C; do not claim comprehensive legal retention support.
- Idempotency keys are scoped by tenant and actor. Different keys may create multiple Indicator Cases. ASM Alert and AppSec Finding single-link constraints remain. No Intelligence Report origin or automatic IOC-to-asset Case generation was added.
- QA used synthetic local tenants and one disposable database. It does not establish production performance, migration safety on active data, or production readiness.
