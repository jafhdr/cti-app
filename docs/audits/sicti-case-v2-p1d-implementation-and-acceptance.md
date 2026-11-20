# SICTI Case Management V2 P1-D — implementation and isolated acceptance

Date: 31 October 2026 (Asia/Jakarta). **Verdict: CASE MANAGEMENT V2 P1-D DEVELOPMENT PASS WITH DOCUMENTED LIMITATIONS.** This is an isolated development result, not production activation or final Case V2 closure.

## Isolation and changes

Work remained in the existing detached `.case-v2-worktree` at `5d06bfcd66f9d7831a65f8d701db31c343bdeff1`. The original dirty workspace and active `cti` database were not changed. The new disposable PostgreSQL database `cti_case_v2_p1d_qa_20261031` received all **75** migrations. The active environment's feature flags and grants stayed unchanged; no commit, push, merge, or deploy occurred.

The P1-D files are `backend/src/cases/cases-operations.{controller,service,query}.ts`, additive module registration, `backend/prisma/schema.prisma`, `backend/prisma/seed.ts`, `backend/prisma/migrations/20261102140000_case_v2_p1d_reporting/migration.sql`, `frontend/app/cases/case-operations-panel.tsx`, `case-operations.css`, the Case page and `frontend/DESIGN.md`. Isolated QA scripts are `backend/qa-case-v2-p1d.cjs`, `qa-case-v2-p1d-performance.cjs`, and `frontend/qa-case-v2-p1d-browser.cjs`.

## API and definitions

`GET /cases/v2/operations/summary` and `/queue` require authentication, Case Management access, `case-workflow` plus dedicated `case-v2-reporting` entitlement, and `CASE_V2_REPORTING_ENABLED=true` (default off). SUPER_ADMIN must select `tenantId`; tenant users cannot select another tenant. Both endpoints are GET-only and use a PostgreSQL repeatable-read, read-only transaction with a database `asOf` value. Every query joins on tenant and case identifiers. All filters are parameterized. Date filters apply to UTC case creation (`from` inclusive, `to` exclusive; maximum 366 days when both are supplied); optional assignee, status, origin, and current-cycle review filters are shared. Queue kinds are ALL, OVERDUE, APPROACHING (next seven days), and REVIEW (pending). Queue sorting is due date ascending with null last, then creation time and ID; page is bounded to 1–100000 and limit to 1–100.

Status totals are mutually exclusive. Active workload is OPEN or IN_PROGRESS, grouped by current analyst with an unassigned bucket. Task counts use persisted CaseTask states. Overdue uses active cases with dueAt before database `asOf`; missing due is separate. Open aging uses createdAt to `asOf`; first closure uses the first cycle-one CaseClosure. First resolution uses the earliest recorded transition activity to RESOLVED, excluding missing history. Median appears at five samples, p90 at ten. Origins include five approved kinds plus LEGACY_UNKNOWN. Current-cycle latest review supplies pending workload, while approved/rejected counts include recorded decisions across cycles. Reopening counts cases, events, and current investigation-cycle totals separately.

## Acceptance evidence

| Gate | Result |
|---|---|
| Prisma schema and migrations | `prisma validate` passed; 75/75 migrations deployed to the disposable database. Reporting indexes added on Case status/due/assignee/creation, review lookup, and first-resolution activity. |
| Backend build and Jest | Nest build passed; 23 suites and 205 tests passed. |
| P1-D PostgreSQL + authenticated HTTP | `qa-case-v2-p1d.cjs` passed 27 assertions for A/B tenant isolation, default-off, unauthenticated denial, root tenant selection, status/workload, UTC due groups, missing history, origins, filters, pagination, and read-only case counts. Empty tenant query returned zeroed metrics. |
| P1-A/B/C and V1 | Existing authenticated P1-A, P1-B (59 checks), and P1-C (91 checks) QA suites passed in the same disposable database. Their V1 compatibility scenarios passed. The P1-C history was independently reported as three approvals, one rejection, one reopening, and two cycles. |
| Frontend | Typecheck and production build passed. Authenticated Chrome QA navigated the Case dashboard and an existing Case detail, using real QA records. Captures at 1280, 768, and 375 px passed the no-page-overflow check and visual inspection. |
| Synthetic query timing | 500 created Cases: summary calls 65 ms cold, then 25/25/26/24 ms; overdue queue 13 ms with 25 returned rows. This is a local workstation measurement, not a production scale benchmark. |

Browser evidence: [1280 px](case-v2-p1d-dashboard-1280.png), [768 px](case-v2-p1d-dashboard-768.png), [375 px](case-v2-p1d-dashboard-375.png). The reporting panel shows real KPI, workload, timing, origin, review, task, and queue data; unauthorized or disabled access hides it. Loading, empty, error, missing history, and pagination states are implemented. The queue remains horizontally scrollable within its panel on narrow screens, consistent with the existing Case table pattern.

## Limits and next gate

Legacy cases may lack origin, resolution transition, due date, or closure records; the response exposes these gaps and does not invent historical SLA rates. Filtered review status describes the latest request in the current investigation cycle, while decision totals count recorded decisions across cycles. A summary and a queue HTTP request each have their own consistent snapshot, so concurrent changes can create a small difference between two separately loaded dashboard sections. The 500-case timing run does not establish large-tenant latency or production concurrency capacity. The reporting catalog entry is default off and rollout still requires a separate entitlement/flag decision.

Recommend the **separate final Case Management V2 development closure review** next. P1-D acceptance alone does not close the overall V2 program.
