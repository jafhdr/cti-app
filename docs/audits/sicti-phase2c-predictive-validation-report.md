# SICTI Phase 2C — predictive hypothesis validation and development closure

**Date:** 10 November 2026\
**Workspace:** `.sicti-flagship-baseline`\
**Verdict:** **VALIDATION INFRASTRUCTURE READY / PREDICTIVE ACCURACY NOT EVALUABLE**

## Historical data readiness

The active `cti` PostgreSQL database was inventoried inside an explicit `BEGIN TRANSACTION READ ONLY` using `backend/qa-phase2c-readiness.sql`. It has 8 tenants, 771 threat actors, 1 campaign, 1 ATT&CK technique, and 1 SIR evidence record. The `TtpObservation`, `TtpObservationReview`, `NextStepRun`, and `NextStepReview` tables are absent there. Consequently there are **zero available historical ordered TTP paths, frozen hypothesis runs, independently adjudicated later-technique outcomes, or complete monitoring windows** to evaluate. No active database rows or schema were changed. Existing Phase 2A/2B records on disposable QA databases are synthetic correctness fixtures and are excluded from accuracy claims.

## Offline evaluation contract

`backend/src/intelligence/next-step-validation.dto.ts` defines a strict, tenant-scoped JSON export with provenance (`REAL_ADJUDICATED` or `SYNTHETIC`), a frozen train/test time split, Phase 2B run snapshots and candidates, observation/catalog availability timestamps, TLP, and independent outcome adjudication or unknown/censored reasons. The exporter and an analyst must substantiate the independently adjudicated label and monitoring record; an arbitrary JSON claim cannot establish field ground truth.

`next-step-validation.ts` replays the frozen `deterministic-1` / `explicit-transitions-1` engine and verifies the stored snapshot digest, candidate ranking, rule trace, evidence IDs, and declared cutoff. It rejects post-cutoff observation creation/ingestion/review, post-cutoff catalog state, future observed intervals, mismatched scope, and incomplete availability. Verified labels require a later analyst, complete horizon monitoring, an outcome within the declared horizon, and a different SIR lineage and observation ID. A dismissal is not a negative label. Unknown and censored cases stay in cohort counts but leave ranking denominators.

The evaluator rejects mixed-tenant exports, selects only cases visible at the requested TLP clearance (including later outcome TLP), checks that snapshot observations are not underclassified, and excludes test campaigns or source lineages seen in training outcomes. The common-outcome baseline is fit only on eligible training labels; the recent-technique baseline uses only each frozen snapshot. The test cohort is selected by `asOf` in the declared held-out interval. Output includes SHA-256 input and selection digests plus selected run IDs for audit and replay.

The CLI reads a local JSON export and writes metrics to standard output, without database access or writes:

```powershell
cd backend
npm run build
node qa-phase2c-evaluate.cjs --input <export.json> --tenant <tenant-id> --max-tlp AMBER
```

The contract supports one tenant per evaluation. A real export must be reviewed for lineage independence, source provenance, monitoring completeness, adjudicator independence, campaign identity changes, and retention before it is marked `REAL_ADJUDICATED`. A schema-valid export does not by itself prove these claims.

## Metrics and uncertainty

The evaluator reports test, evaluable, generated, abstained, unknown, censored, TLP-excluded, group-leak-excluded, and training-outcome counts. It computes top-1/top-3 hit rates, generated coverage, abstention rate, false candidate hypotheses per evaluable run, lead time in hours for matched verified steps, and top-1/top-3 hits for both simple baselines. Rate results include denominators and Wilson 95% intervals. These are descriptive intervals, not a significance test or calibrated probability. The Phase 2B support score is never treated as a probability.

The actual historical cohort is empty: **test runs 0; evaluable outcomes 0; training outcomes 0**. Top-1, top-3, coverage, abstention, false-hypothesis rate, lead time, and baseline comparison are **not statistically applicable**. Running `qa-phase2c-evaluate.cjs` on `qa-phase2c-empty-real.json` returns `NOT_EVALUABLE`, null rate metrics, and audit digests. Synthetic tests exercise one successful labeled path but deliberately return `SYNTHETIC_CORRECTNESS_ONLY`; its numerical hits are not predictive performance.

## Validation and regression evidence

| Gate | Result |
|---|---|
| Phase 2C synthetic evaluator tests | 6 passed: frozen replay/determinism, verified hit and baseline arithmetic, unknown exclusion, future-data and digest rejection, mixed tenant, RED run and outcome filtering, lineage independence, empty real cohort, TLP underclassification, and cutoff tampering. |
| Backend unit suite | 28 suites, 223 tests passed after the final Phase 2C evaluator changes. |
| Prisma schema | Valid with the locally installed schema engine and a nonconnecting validation URL; no migration was added or altered in Phase 2C. |
| Backend | Production Nest build passed; offline CLI empty-real cohort smoke passed with `NOT_EVALUABLE`. |
| Frontend | Type check and production build passed. Production build required unsandboxed worker spawning after sandbox `spawn EPERM`. No UI code changed in Phase 2C. |
| Browser | No new browser surface or endpoint was introduced. Phase 2B authenticated browser checks remain the relevant application-path evidence; no active database was used for a browser write in Phase 2C. |

## Limits and next evidence gate

The framework is an offline consumer of a trusted export, not an automated historical extractor or proof that an uploaded adjudication is true. The active database lacks the Phase 2A/2B tables, so no real replay, held-out comparison, analyst burden, per-tenant/tactic stratification, or prospective shadow-monitoring estimate can be made. The present two explicit transition rules remain investigation prompts. Source lineage IDs are a proxy for independent origins; duplicated upstream reporting can defeat that proxy. No calibration, accuracy threshold, ML training, automated response, deployment, or predictive effectiveness claim is justified.

Before future predictive claims, collect tenant-scoped Phase 2A observations and Phase 2B runs over a predeclared period; retain immutable source and catalog history; independently adjudicate subsequent techniques and complete monitoring windows; establish inter-analyst agreement and censoring rules; freeze cohort splits, baselines, thresholds, and analyst review burden; then evaluate held-out and prospective data. Phase 2D was not started.
