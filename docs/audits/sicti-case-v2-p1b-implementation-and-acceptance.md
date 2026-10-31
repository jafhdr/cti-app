# SICTI Case Management V2 P1-B — implementation and isolated acceptance

Date: 31 October 2026 (Asia/Jakarta). **Verdict: CASE MANAGEMENT V2 P1-B DEVELOPMENT PASS WITH DOCUMENTED LIMITATIONS.** This is isolated development acceptance. No active database migration, feature activation, commit, push, merge, or deployment occurred.

## Isolation and scope

Work continued in the existing detached `.case-v2-worktree` at `5d06bfcd66f9d7831a65f8d701db31c343bdeff1`, preserving uncommitted P1-A work and the original dirty workspace. The new disposable PostgreSQL database `cti_case_v2_p1b_qa_20261030` received all 73 migrations, including the P1-B migration after the two P1-A migrations. QA processes set `CASE_V2_WORKFLOW_ENABLED=true` only for synthetic tests. The default remains off. `case-v2-workflow` is registered in the feature catalog but is not assigned in the active environment.

## Implementation

| Area | Result |
|---|---|
| Tasks | Tenant-composite `CaseTask` records with creator, assignee, timestamps, and TODO → IN_PROGRESS → DONE or cancellation. Terminal tasks cannot be reopened. ADMIN/SUPER_ADMIN create and assign; USER updates progress only on their assigned task and cannot cancel or reassign it. Changes append CaseActivity and AuditLog inside the same transaction. |
| Handoff | Reason-required reassignment records previous/new assignee IDs and names in immutable `CaseHandoff` history. A changed assignee enqueues exactly one existing assignment notification in the same transaction. |
| Due date and SLA | Nullable UTC `Case.dueAt`; overdue is derived only for OPEN/IN_PROGRESS Cases when dueAt is before the current instant. `slaPolicyKey` is a nullable reserved policy reference; no policy catalog, automatic penalty, or breach notification is assumed. |
| Concurrency | `Case.revision` and required `expectedRevision` on P1-B mutations; conditional increment yields HTTP 409 on stale decisions. Existing V1 update/assignment increment revision without changing their request contract. |
| API/access | `GET /cases/:id/workflow`, `POST /cases/:id/tasks`, `PATCH /cases/:id/tasks/:taskId`, `POST /cases/:id/handoff`, and `PATCH /cases/:id/due-date` require normal authentication, module/feature access, role checks, tenant-scoped Case selection, and the default-off environment gate. SUPER_ADMIN must select a tenant. Foreign resources are concealed. |
| UI | The existing Case detail workspace now shows tasks, assignment/progress actions, handoff reason/history, due date, and overdue status. It has loading, empty, error, 409 refresh, and role-specific controls. A 403 entitlement/gate response hides the V2 panel. Existing design tokens and layout are reused. |

No V2 closure, reopening, peer review, operational report, or TI/ASM/AppSec lifecycle mutation was added. V1 remains responsible for Case status transitions.

## Acceptance evidence

- `prisma validate` **PASS**; `prisma generate` **PASS**; `prisma migrate deploy` applied all **73** migrations to the disposable database; backend `npm run build` **PASS**; frontend `npm run typecheck` **PASS**; frontend production build **PASS**.
- Authenticated NestJS HTTP plus Prisma assertions in `backend/qa-case-v2-p1b.cjs`: **59 checks PASS**. This covers task creation, reassignment, progress/completion, terminal and USER restrictions, ADMIN/SUPER_ADMIN boundaries, A/B tenant isolation, explicit SUPER_ADMIN tenant selection, missing revision, concurrent stale 409, UTC due-date validation, overdue transitions, handoff history/one outbox event, immutable handoff, V1 status/update/delete compatibility, and a deliberately failed task insert that rolled back the revision, task, and audit count. Latest synthetic run: tenant A `cmvv8bzw50000gpbwg7tq4s6m`, tenant B `cmvv8c00p000xgpbwt0srdnrw`.
- P1-A authenticated provenance/idempotency scenario **PASS** on the P1-B schema (its script prints the earlier database name as a fixed label; `DATABASE_URL` selected the P1-B QA database). Focused V1 Case node tests **15/15 PASS**; backend Jest **205/205 PASS across 23 suites**. The typed assignment test fixture was extended for the new Case columns.
- Real login and browser interactions via `frontend/qa-case-v2-p1b-browser.cjs`: **PASS** at **1280, 768, and 375 px**, creating a task, starting it, setting an overdue due date, and handing off a fresh open Case. No error alert or horizontal overflow. Screenshots: `case-v2-p1b-browser-1280.png`, `case-v2-p1b-browser-768.png`, `case-v2-p1b-browser-375.png`. All three were visually inspected; the controls fit the existing Case layout.
- `git diff --check` **PASS**. Temporary browser/backend QA servers were stopped.

## Limits and rollout boundary

- The SLA policy contract is deliberately a nullable policy key plus UTC due date and derived overdue boolean. Policy definitions, tenant configuration, breach schedules, and penalties need a later explicit product decision.
- Task and handoff history is visible in the Case detail UI and audit timeline, but this phase has no dedicated export/reporting surface. Existing V1 assignment controls still work and increment revision; they do not create a P1-B handoff record because V1 does not require a reason.
- QA used synthetic tenants and a disposable local database. It does not establish production performance or active-data migration safety. Keep both V2 flags and feature entitlements disabled until a separately approved rollout.
