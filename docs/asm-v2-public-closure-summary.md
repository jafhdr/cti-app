# Attack Surface Management V2 development closure

**Status: DEVELOPMENT CLOSED WITH DOCUMENTED LIMITATIONS** (owner approved, 29 October 2026). This records completion of the agreed P1-A through P1-D development scope. It is **not** a production readiness, migration, rollout, or deployment approval.

## Completed scope

| Phase | Development capability |
| --- | --- |
| P1-A — evidence and refresh safety | Tenant-specific V2 enrollment; append-only correlation observation evidence with provenance and deterministic hash; complete versus inconclusive discovery safeguards; V1/V2 refresh separation. V2 refresh does not automatically open or resolve a historical ASM Finding. |
| P1-B — analyst review | ACCEPT, REJECT and REQUEST_REVIEW with a narrow reviewer feature grant, actor/reason/decision history and audit trail. Expected revision, current evidence hash, request-key idempotency and concurrency checks protect decisions. |
| P1-C — contextual asset priority | A versioned, deterministic, explainable evaluator. Only ACTIVE, ACCEPTED, current and fresh V2 evidence contributes. Criticality, CVE severity, observed OPEN services and optional CVSS are explained with exclusions and uncertainty. V1 Risk Posture remains a separate metric. |
| P1-D — operational visibility | Tenant-scoped review/observation summary, current actionable relevance, prioritized asset list, NOT_ASSESSED results, bounded filtering and cursor pages. Reporting reuses the P1-B queue and P1-C evaluator and is read-only. |

TI retains ownership of Vulnerability/Indicator records and intelligence provenance; ASM owns asset-specific observation, correlation, review and priority; AppSec owns application Finding remediation; Case Management owns investigation lifecycle. A machine match or accepted relevance decision does not prove exploitation, compromise, or public internet exposure.

## Accepted development verification

Earlier isolated acceptance replayed **70/70 migrations** on a disposable PostgreSQL database, passed backend production build, frontend typecheck and production build, **16/16** connected ASM/V1 tests, **22/22** focused unit tests, and **26/26** TI/AppSec/Case regression tests. Authenticated browser acceptance covered roles, tenant isolation and responsive layouts at **1280, 768 and 375 px**. These are previously completed acceptance results; this document did not rerun them. See [the QA runbook](asm-v2-qa-runbook.md) for the current harness and its constraints.

## Documented limitations

- Historical V1 `VULNERABILITY_CORRELATION` Findings and Alerts are not automatically reconciled with V2 review. A V1 Finding may remain OPEN when the corresponding V2 evidence is REJECTED or STALE. V2 decisions do not silently close or reopen it; V2 priority/reporting exclude rejected or stale relevance while showing V1 posture separately. Rollout to affected tenants requires an explicit ownership and reconciliation policy.
- P1-C evaluates at most **100 correlations per asset**. Above the cap, it returns **NOT_ASSESSED**, never a partial LOW score. Its initial freshness policy is **30 days**. Optional CVSS is marked as uncertainty when absent. Existing MEDIUM criticality may be a database default rather than a confirmed choice.
- P1-D query profiling used a small fixture and does not certify large-tenant performance. Bounded tenant scans can grow in duration; the read transaction has a **120-second timeout**. Summary and asset-list requests have separate snapshots. Cursor consistency assumes an unchanged dataset and filter; concurrent updates can change later pages.

## Production boundary

Production readiness is **not declared**. No active-database migration, general tenant activation, automatic historical Finding reconciliation or deployment is authorized by development closure. A separate release decision requires migration and backup/restore planning, active-database compatibility, Finding/Alert ownership, effective grants, representative load testing, freshness/criticality policy, security review, monitoring and rollback acceptance. Backend rollout gates and tenant enrollment remain separate, default-off controls.
