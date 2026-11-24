# SICTI Phase 2A â€” evidence foundation implementation report

**Date:** 10 November 2026\
**Workspace:** `.sicti-flagship-baseline` only\
**Verdict:** **PHASE 2A DEVELOPMENT CLOSED**. Additive implementation, isolated PostgreSQL migration and integration, authenticated browser/security workflow, screenshots, and relevant TI/Phase 1C regressions passed. The active `cti` database was inventoried read-only and never modified.

## Delivered implementation

- Added tenant-owned `TtpObservation` and append-only `TtpObservationReview` records, an additive migration, composite tenant foreign keys to actor/campaign/technique/SIR evidence, interval and confidence checks, and a tenant-scoped idempotency key. The original SIR reference, title, relevance note, and SHA-256 digest are frozen on creation; the live SIR evidence record is retained by restrictive foreign key. No IOC correlation can create or confirm an observation automatically.
- Added an API under `intelligence/ttp-observations` using existing authentication, role, Threat Intelligence module, and `intelligence-hub` feature guards. Admins create and review; regular users read tenant-scoped timelines without RED observations. Evidence linked to a RED report is also hidden from regular users, including if report classification changes later. Creation rejects missing or foreign tenant references, mismatched campaign actors, unsupported SIR evidence links, invalid intervals, and a TLP below an associated source/report classification. Review uses expected status for concurrent-change detection and writes review and audit records transactionally.
- Added a shared ATT&CK observation timeline to the existing Threat Actor and Campaign detail cards. It shows candidate/confirmed/disputed/rejected text, observed intervals and uncertain ordering, source snapshot, ATT&CK version, separate confidence dimensions, and review history. Admins can create a candidate from linked SIR evidence and review it; the screen explicitly says it does not predict a next step. It reuses the existing design tokens and responsive panel styles.
- Added a read-only QA data inventory command, PostgreSQL integration suite, and authenticated browser script guarded by an explicit disposable QA fixture. No prediction engine, ML, or automated mitigation was added.

## Schema and evidence contract

`TtpObservation` stores `tenantId`, `idempotencyKey`, optional `threatActorId`/`campaignId` (at least one required), required `mitreTechniqueId`, analyst-entered `attackVersion`, required `sirEvidenceId`, frozen `evidenceSnapshot` and `evidenceDigest`, `attributionBasis`, `observedStartAt`/`observedEndAt`, `timePrecision` (`INSTANT`, `HOUR`, `DAY`, `INTERVAL`), server `ingestedAt`, TLP, source reliability and evidence credibility snapshots where assessable, actor/technique confidence (0â€“100), status, creator and timestamps. A confirmation never changes evidence or time; it appends a review (`CONFIRMED`, `DISPUTED`, or `REJECTED`) with reason, reviewer, and time. Creation starts at `CANDIDATE`. Rejected observations remain visible for audit but excluded from any confirmed path.

Intervals are sorted by start, end, and ID. The API labels a row `OVERLAPS` when its interval intersects the prior row; this is **uncertain ordering**, not an inferred attack-path edge. `INSTANT` requires equal start/end; other precisions require a nonzero interval. Source reliability and evidence credibility remain separate and explicitly unassessed when no linked assessment exists. The current SIR evidence model has no direct source/TLP classification, so an analyst selects TLP; existing report/source links impose a floor when present. This limitation needs review before a broader rollout.

| API | Contract |
|---|---|
| `GET /intelligence/ttp-observations?actorId=...` or `?campaignId=...` | Exactly one scope; up to 100 records in chronological order, with ordering label and review history. Actor view also includes that actor's campaign observations. Regular users receive no RED records. Super-admin passes `tenantId`. |
| `GET /intelligence/ttp-observations/evidence-options?actorId=...` or `?campaignId=...` | Admin-only list of up to 50 SIR evidence links attached to the chosen actor/campaign. |
| `POST /intelligence/ttp-observations` | Admin-only candidate creation. Requires idempotency key, actor/campaign scope, technique, ATT&CK version, linked SIR evidence, basis, interval/precision, TLP, and technique confidence; optional actor confidence. Reuse of a key with a different payload returns conflict. |
| `POST /intelligence/ttp-observations/:id/reviews` | Admin-only review with `status`, `expectedStatus`, and a reason of at least 10 characters. Atomic status update, review row, and audit log. |

All APIs inherit existing tenant/module/feature guards. Direct ID lookups are scoped by tenant; cross-tenant references return not found. Database foreign keys independently enforce tenant match for linked evidence and entities. The browser receives no prediction or probability field.

## Changed files

| Area | Files |
|---|---|
| Schema | `backend/prisma/schema.prisma`; `backend/prisma/migrations/20261109130000_ttp_observation_foundation/migration.sql` |
| Backend | `backend/src/intelligence/ttp-observation.logic.ts`, `ttp-observations.dto.ts`, `ttp-observations.service.ts`, `ttp-observations.controller.ts`, `intelligence.module.ts` |
| Frontend | `frontend/components/intelligence/TtpTimeline.tsx`; Threat Actor and Campaign panel/workspace integrations; `frontend/app/editorial.css`; `frontend/DESIGN.md` |
| QA | `backend/src/intelligence/ttp-observation.logic.spec.ts`, `ttp-observations.dto.spec.ts`, `ttp-observations.integration.spec.cjs`; `backend/qa-phase2a-readiness.cjs`; `frontend/e2e/phase2a-observation-browser.cjs`, `phase2a-visual-preview.cjs` |

All pre-existing V1/V2, ASM, AppSec, Case, and Phase 1C files and migration history remain in place. The baseline had substantial pre-existing uncommitted work; nothing was committed, merged, pushed, or deployed.

## Data readiness

The root checkout `backend/.env` supplied the existing local PostgreSQL connection after the user directed us to use it. A read-only inventory of the active `cti` database found 8 tenants, 771 threat actors, 1 campaign, 1 ATT&CK technique, 0 campaign-technique links, and 1 SIR evidence record. The older active database has no ThreatEvent or ThreatCorrelation tables. These records provide no meaningful time-ordered TTP history or outcome labels for predictive profiling. No active database schema or data was changed. All functional evidence below came from synthetic records in two disposable QA databases.
## Validation and evidence

| Gate | Result |
|---|---|
| Prisma schema validation, client generation, backend TypeScript/build, frontend TypeScript/build | Passed. |
| Backend unit suite | **26 suites, 213 tests passed**, including Phase 2A ordering/DTO and Phase 1C correlation rules. |
| PostgreSQL migration | **80 migrations applied successfully** to `cti_phase2a_qa_*`; a second `cti_corr_qa_*` database was migrated and seeded for Phase 1C regression. |
| Phase 2A PostgreSQL integration | **5/5 passed**: creation/review/history, overlapping intervals, RED hiding, cross-tenant rejection, and idempotency conflict. |
| Authenticated browser E2E | **Passed** on the QA API and production frontend: login, candidate creation, analyst confirmation, rejection, chronological ordering, ambiguous overlapping intervals, USER create denial and RED hiding, and foreign-tenant GET/POST denial. |
| Existing TI integration | Threat actor ingestion **12/12 passed**; MITRE ingestion **6/6 passed**. |
| Phase 1C correlation integration | Connector credential/security/restart **1/1 passed**; HTTP IOC-to-alert **1/1 passed**, with isolated-QA flags and worker enabled. |
| Authenticated screenshots | [Desktop](sicti-phase2a-desktop.png) and [mobile](sicti-phase2a-mobile.png) show the same confirmed source-backed observation in the real logged-in workspace after a clean synthetic fixture run. |

The previous synthetic mock preview was reviewed by two independent visual reviewers and is retained in `.omo/evidence/sicti-phase2a-preview` as layout development evidence. The authenticated captures above are the final product evidence. The mobile capture shows a single-column timeline without horizontal overflow.

## Known limits and Phase 2B boundary

- The SIR evidence model has no direct source/TLP classification. Analysts select observation TLP, while linked report/source classifications impose a floor when present. This needs policy review before a broader rollout.
- The 100-record timeline limit and source reliability/credibility snapshots are evidence-foundation contracts, not calibrated predictive signals. The active data inventory cannot support accuracy claims or model training.
- The browser E2E covers the listed workflow and security boundaries; specialized race, delete-conflict, and later source reclassification cases are not claimed as browser coverage. The PostgreSQL suite covers idempotency conflict and RED visibility.
- Nothing was committed, pushed, merged, or deployed. Phase 2B remains separate work.
**Exact next Phase 2B task, only after Phase 2A closure and separate authorization:** define a versioned, deterministic next-technique hypothesis run contract over **confirmed** time-ordered observations, with evidence/counterevidence links, explicit abstention, reproducible snapshots, and analyst disposition. No Phase 2B implementation is included here.
