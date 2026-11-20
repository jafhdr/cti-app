# SICTI Phase 2B — explainable next-step hypothesis report

**Date:** 10 November 2026\
**Workspace:** `.sicti-flagship-baseline` only\
**Verdict:** **PHASE 2B DEVELOPMENT CLOSED**. The deterministic, analyst-triggered hypothesis workflow passed isolated database, browser, security, build, and relevant regression checks. It is an investigation aid, not a validated prediction system.

## Implemented architecture and files

- Added tenant-owned `NextStepRun`, `NextStepCandidate`, and append-only `NextStepReview` records with composite tenant foreign keys, unique idempotency keys, bounded horizon and score checks, frozen input JSON and SHA-256 digest, rule/engine versions, abstention reason, ranked candidates, analyst dispositions, and later outcome evidence.
- `POST /intelligence/next-step-runs` creates a run for exactly one actor or campaign at a declared as-of cutoff. `GET /intelligence/next-step-runs?actorId=...` (or `campaignId`) returns scoped history. `POST /intelligence/next-step-runs/candidates/:id/reviews` appends a disposition or outcome with an expected latest review ID to reject stale concurrent actions. All routes inherit authentication, roles, Threat Intelligence module, and `intelligence-hub` feature guards. Only admins create/review; tenant users receive TLP-filtered read access.
- Threat Actor and Campaign detail cards now show run history, explicit abstention, rule and score traces, support/counterevidence IDs, investigation steps, append-only analyst history, and outcome controls. Accepted guidance can be copied into an existing Case Management note; no case, alert, block, or mitigation is created automatically.

| Area | Changed files |
|---|---|
| Schema | `backend/prisma/schema.prisma`; migrations `20261110015713_next_step_hypothesis` and `20261110030000_next_step_catalog_snapshot` |
| Engine/API | `backend/src/intelligence/next-step.logic.ts`, `next-step.dto.ts`, `next-step.service.ts`, `next-step.controller.ts`, `intelligence.module.ts` |
| UI | `frontend/components/intelligence/NextStepHypotheses.tsx`, Threat Actor and Campaign panels, `frontend/app/editorial.css`, `frontend/DESIGN.md` |
| QA | `next-step.logic.spec.ts`, `next-step.integration.spec.cjs`, `backend/qa-phase2b-fixture.cjs`, `frontend/e2e/phase2b-hypothesis-browser.cjs`; the Phase 2A fixture/guard accepts Phase 2B disposable QA databases |

## Rules, evidence, and cutoff contract

The engine is `deterministic-1` with `explicit-transitions-1`. Two documented, analyst-authored investigation rules are available: observed `T1059` command execution can prompt investigation of `T1105` tool transfer; observed `T1105` tool transfer can prompt investigation of `T1021` remote services. These rules express possibilities, never observed edges or an ATT&CK tactic-order inference. A target technique must exist in the tenant catalog at the cutoff.

Inputs are the latest 200 actor/campaign observations that were created and ingested by the cutoff and whose observed interval ended by then. Their review history is evaluated **as of** the cutoff; later reviews cannot rewrite a past run. The snapshot freezes observation IDs, source SIR lineage IDs, campaign context, ATT&CK version, technique mapping, interval, confidence, status, and TLP, plus the eligible catalog labels. A later catalog entry is excluded. If a mapped catalog record changed after the cutoff and its old state is unavailable, the run abstains. The stored digest covers the complete canonical snapshot, scope, horizon, and rule/engine versions. Candidate technique labels are frozen separately so a later catalog edit cannot silently change a published explanation.

Generation requires two confirmed, source-backed observations from different SIR lineages, ordered without interval overlap, in the same campaign context, with actor and technique confidence at least 60/100 and one ATT&CK version. A dispute in the confirmed input chain, ambiguous timing, weak attribution, mixed catalog versions, missing target catalog mapping, or insufficient evidence causes an explicit `ABSTAINED` run with no candidates. A disputed mapping of a *proposed* target remains visible as counterevidence. The heuristic score is a transparent sum: base 30, attribution confidence divided by five, technique confidence divided by five, independent corroboration 10, minus 30 for disputed target evidence, and minus 20 when the target technique was previously confirmed. It is capped at 0–100 support points and is **not a probability**. The trace names every component, support/counterevidence IDs, rule version, and two concrete analyst checks.

Run creation is idempotent within a tenant; reuse with a different request conflicts. Review rows are append-only and audit logged. Dispositions are `ACCEPT_FOR_INVESTIGATION`, `DISMISSED`, and `ALREADY_OBSERVED`. Outcomes are `VERIFIED`, `UNCERTAIN`, and `UNOBSERVABLE`; only `VERIFIED` accepts a later, same-scope, same-technique, confirmed observation within the declared horizon from an independent SIR lineage. A dismissal is not treated as a negative ground-truth label. A regular user cannot see a run containing RED snapshot evidence or a RED outcome, including later RED report classification on linked evidence. Foreign-tenant scope IDs return not found.

## Validation

| Gate | Result |
|---|---|
| Prisma schema and migration | Valid; **82 migrations** up to date on disposable `cti_phase2b_qa_*` PostgreSQL. A second browser QA database and separate `cti_corr_qa_*` regression database were migrated. |
| Backend unit suite | **27 suites, 217 tests passed**, including generation, stable ranking, rule version, counterevidence, and abstention cases. |
| Phase 2B PostgreSQL integration | Passed: independent confirmed sources, idempotency, reproducible replay, late-arriving observation and catalog exclusion, post-cutoff catalog drift abstention, tenant isolation, concurrent review, rejection of a future-dated record ingested before the run, verified outcome, and RED run/outcome hiding. |
| Authenticated Chrome E2E | Passed: two confirmed source-backed observations → generated T1105 hypothesis and explanation → analyst acceptance → later independently confirmed observation → verified outcome. USER write and foreign-tenant read were denied. |
| Phase 2A regression | TTP observation PostgreSQL integration **5/5 passed**. |
| Threat Intelligence regressions | Threat actor ingestion **12/12 passed**; MITRE ingestion **6/6 passed**. |
| Phase 1C correlation regressions | Connector credential/security/restart **1/1 passed**; HTTP IOC-to-alert **1/1 passed** with isolated QA flags. |
| Builds and visual QA | Backend build, frontend type check and production build passed. Independent design-system and visual/functional reviewers approved the final authenticated desktop/mobile captures. |

Authenticated screenshots: [desktop](sicti-phase2b-desktop.png) and [mobile](sicti-phase2b-mobile.png). They show the confirmed observations, generated explanation, accepted disposition, and recorded verified outcome in the real application. The 390px layout stacks controls without visible horizontal clipping.

## Data readiness and limitations

The active `cti` database was not modified. The Phase 2A read-only inventory found 8 tenants, 771 actors, 1 campaign, 1 ATT&CK technique, no campaign-technique links, and 1 SIR evidence row, without historical TTP paths or outcome labels. Phase 2B testing therefore used explicitly synthetic, disposable QA tenants and records. Neither a support score nor the verified synthetic outcome establishes predictive accuracy, calibration, or field effectiveness.

Only two explicit transition rules are implemented. SIR lineage is a proxy for source independence; two reports can still share an underlying origin. Historical ATT&CK edits without a versioned catalog snapshot force abstention. The 200-observation input cap and 50-run history cap bound work but need pagination and data governance review before wider rollout. Case guidance is a human copy/link workflow. `Product_SISI.pdf` was not present at the referenced path during this run; the existing Phase 2 plan's page-11 summary and the available `uiux/CTI.pdf` were used. No ML model, predictive alert, automated mitigation, commit, push, merge, or deployment was performed.

**Exact next Phase 2C validation task:** build a frozen retrospective evaluation set of independently adjudicated, tenant-scoped later-technique outcomes with monitoring coverage and censoring labels; run time-split backtests of the versioned Phase 2B rules, measure abstention/coverage and ranking quality by tenant, tactic, and horizon, audit leakage and calibration limits, and publish an analyst-reviewed validation report before any accuracy or probability claim. Phase 2C is not implemented here.
