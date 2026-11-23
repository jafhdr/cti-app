# SICTI PR #7 Phase 5E-B — Same-Head Stateful Integration Validation

Date: 2026-11-23 (Asia/Jakarta)
Repository: `jafhdr/cti-app`
Draft PR: `#7` (left Draft; no PR mutation performed)
Reviewed revision: `6aa47eaa47c1849305dd6f815c34ce7d4d37cbdf`

## Verdict

**STATEFUL CI COVERAGE READY FOR COMMIT REVIEW**

The committed SOAR, ASM V2, and AppSec V2 stateful suites passed against three fresh disposable PostgreSQL databases using an archive of the reviewed revision. A single additive CI job now reproduces the validated database, migration, seed, fixture, and test boundaries on every pull-request revision. No application code, schema, migration, assertion, or existing CI job was changed.

## Same-head and environment verification

- Candidate worktree `HEAD`: `6aa47eaa47c1849305dd6f815c34ce7d4d37cbdf`.
- Cached `origin/integration/sicti-flagship-candidate`: same SHA.
- Live `git ls-remote` checks for the integration branch and `refs/pull/7/head`: same SHA.
- Test source: `git archive` of that SHA, extracted into an isolated Linux container; untracked QA artifacts were not included.
- Runtime: Node.js `v22.23.5`, npm `10.9.9`, PostgreSQL `16.16`, Prisma CLI/client `6.19.3`.
- Build prerequisite: `npx prisma generate` and `npm run build` passed.
- Each database received all 91 committed migrations and the committed synthetic seed.
- The active `cti` database was never addressed or accessed.

## Stateful results

| Module | Disposable database | Suites | Tests | Result | Duration |
| --- | --- | ---: | ---: | --- | ---: |
| SOAR | `cti_soar_qa_sict65_65a1b2c3` | 5 files | 6 | 6 passed, 0 failed | 40.537 s |
| ASM V2 | `cti_asm62_qa_case20_65a1b2c3` | 7 files | 7 | 7 passed, 0 failed | 14.160 s |
| AppSec V2 | `stake49_closure_65a1b2c3d4` | 5 files | 5 | 5 passed, 0 failed | 9.422 s |
| **Total** | 3 fresh databases | **17 files** | **18** | **18 passed, 0 failed** | **64.119 s** |

### SOAR suites

- `backend/src/playbooks/playbook.http.integration.spec.cjs`
- `backend/src/playbooks/sandbox-connector.integration.spec.cjs`
- `backend/src/playbooks/sandbox-recovery.integration.spec.cjs`
- `backend/qa-phase3c-mock-persistence.spec.cjs`
- `backend/qa-phase3c-full-app.spec.cjs`

Prerequisites were `qa-phase3a-fixture.cjs` and `qa-phase3b-fixture.cjs`, two synthetic analysts, `SICTI_ISOLATED_QA=true`, and `SICTI_SOAR_QA_ENABLED=true` at application startup. The tests covered separate confirmation/approval, sandbox-only execution and verification, signed persisted mock state, idempotency and replay protection, rollback, outage/restart recovery, tenant isolation, immutable receipts, and audit persistence. The connector is a loopback synthetic provider; Telegram, monitoring connectors, correlation workers, notification workers, and follow-up workers remained disabled. No real mitigation was attempted.

### ASM V2 suites

- `backend/src/attack-surface-management/asm-v2-p1a.integration.spec.cjs`
- `backend/src/attack-surface-management/asm-v2-p1a.http.spec.cjs`
- `backend/src/attack-surface-management/asm-v2-p1b.http.spec.cjs`
- `backend/src/attack-surface-management/asm-v2-p1c.http.spec.cjs`
- `backend/src/attack-surface-management/asm-v2-p1d.http.spec.cjs`
- `backend/src/attack-surface-management/asm-v2-fingerprint.integration.spec.cjs`
- `backend/src/attack-surface-management/asm-v2-fingerprint-order.integration.spec.cjs`

The database identity satisfies the strict ASM QA guard. Results covered authenticated enrollment/evidence, asset relationships, independent review, tenant boundaries, discovery ordering, SSH fingerprint persistence/retirement, vulnerability-correlation priority, and read-only operational reporting. All external workers remained disabled.

### AppSec V2 suites

- `backend/src/appsec/appsec.p1a.integration.spec.cjs`
- `backend/src/appsec/appsec.p1b.integration.spec.cjs`
- `backend/src/appsec/appsec.p1c.integration.spec.cjs`
- `backend/src/appsec/appsec.p1d.integration.spec.cjs`
- `backend/src/appsec/appsec.v2-closure.integration.spec.cjs`

The closure database name and `APPSEC_CLOSURE_QA_DB_NAME` satisfied the strict closure guard. Results covered authenticated finding lifecycle, revision and tenant enforcement, assigned remediation grants, atomic evidence, independent validation/rework/terminal decisions, reporting reconciliation, authorization, and the cross-module linked-Case relationship without incorrectly closing the Case.

## CI addition

The smallest safe addition is one new `stateful-integration` job in `.github/workflows/sicti-ci.yml`:

- retains the existing four jobs byte-for-byte;
- uses `actions/checkout` with `persist-credentials: false`, Node 22, and PostgreSQL 16;
- creates three fresh named databases within the job-local service;
- deploys committed migrations and seed data independently to each database;
- runs the exact 17 validated files serially with the same guards and synthetic-only flags;
- enables SOAR only inside the isolated QA job while production connectors and background workers remain disabled;
- has a 30-minute job timeout and read-only repository permissions inherited from the workflow.

The proposed commands were exercised locally in the matching Node 22/PostgreSQL 16 container environment. `git diff --check` passed. The job itself cannot be observed on GitHub until the change is committed and pushed; that is the only remaining operational confirmation for this focused Phase 5E-B coverage change, not a local coverage blocker.

## Remaining blockers and scope boundary

- No local Phase 5E-B stateful-suite blocker remains: all 18 tests passed on the reviewed same-head source.
- The additive job still needs a committed remote green run before repository enforcement can be claimed active.
- This focused verdict is not overall PR merge readiness or production approval. The prior review's remaining PR-wide gates are still unresolved: the Monitoring inactive-Case policy, unified staging/E2E on the combined release candidate, explicit frontend-overlap acceptance, final human approval, and the affected final-SHA review reruns.
- Production provider authorization, credential lifecycle, data protection/retention, operational SLOs, observability, HA/recovery, rollout controls, and rollback remain separate release requirements.
- PR #7 must remain Draft and unmerged until those independent gates are closed or explicitly accepted by maintainers.

## Sanitized evidence and anomalies

Final TAP summaries contained no credentials or production identifiers:

```text
SOAR:  tests 6; pass 6; fail 0; duration_ms 40536.886299
ASM:   tests 7; pass 7; fail 0; duration_ms 14160.056247
AppSec: tests 5; pass 5; fail 0; duration_ms 9421.921863
```

An initial harness attempt produced SOAR `404` instead of the expected pre-approval `409` because the QA feature gate was absent/disabled at application startup. The database was destroyed and recreated, the committed startup prerequisite was supplied (`SICTI_SOAR_QA_ENABLED=true`), and the entire SOAR suite then passed 6/6. No assertion or implementation was modified.

## Changed files

- `.github/workflows/sicti-ci.yml` — additive stateful integration job only.
- `docs/audits/sicti-pr7-phase5e-stateful-integration-validation.md` — this report.

No commit, push, merge, deployment, schema change, migration change, production connector activation, or PR-state change was performed.
