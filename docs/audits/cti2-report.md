# CTI Platform Hardening Phase 1B — Final Closure

## 1. Verdict

**PASS.** SUPER_ADMIN Case routes with `:id` now require an explicit selected tenant and return 404 when the Case belongs to another tenant. Existing global SUPER_ADMIN authorization is unchanged.

## 2. Case Tenant Contract

| Operation | SUPER_ADMIN | ADMIN | USER | Cross-tenant Result |
| --- | --- | --- | --- | --- |
| List/create/detail | Selected tenant | Session tenant | Session tenant, read only | List scoped; detail 404 |
| Update/delete/assign | Selected tenant query required | Session tenant | Denied by role | 404 |
| Note/evidence and activity | Selected tenant query required | Session tenant | Session tenant; note/evidence policy retained | 404 |
| Indicator, Threat Actor, Campaign link/unlink | Selected tenant query required; related entity must match Case tenant | Session tenant | Mutation denied by role | 404 |
| ASM Alert link | Selected tenant query required; body tenant and Alert must match Case tenant | Session tenant | Mutation denied by role | 404 |
| Case creation from Indicator or ASM Alert/Finding | Source tenant from existing flow; no Case ID yet | Session tenant | Creation denied by role | Foreign source 404 |

Missing SUPER_ADMIN tenant query on a Case ID route returns 400. ADMIN/USER query values cannot override session tenant.

## 3. Files Changed

| Files | Change |
| --- | --- |
| `backend/src/cases/case-tenant.guard.ts`, `cases.controller.ts`, `cases.module.ts` | Shared Case ID tenant check on every Case controller route. |
| `frontend/app/cases/case-access.tsx`, `layout.tsx`, `[id]/page.tsx`, `[id]/assign-modal.tsx`, `[id]/edit-case-modal.tsx`, `[id]/investigation-panel.tsx`, `[id]/related-{indicators,threat-actors,campaigns}.tsx` | Send selected tenant on Case detail, action, and relation requests; remount workspace on tenant switch. |
| `backend/src/cases/case-tenant.guard.spec.ts`, `cases.from-indicator.spec.cjs`, `frontend/e2e/cti-phase1-access.spec.ts`, `case-investigation.spec.ts` | Tenant guard, role, switch, action, and regression evidence. |

Phase 1 changes and unrelated existing worktree edits were preserved. No migration, commit, or push was made.

## 4. Security Result

Guard tests verify SUPER_ADMIN A→A success, A→B 404, switch to B→B success, and missing tenant 400. A class-level guard covers Case ID reads and mutations. Existing service logic retains ADMIN/USER session scoping, related entity tenant matching, and 404 behavior. Role metadata keeps USER out of update/delete/assign/relation mutations; USER note/evidence access follows the established investigation policy. Browser QA observed no stale Case A detail or subsequent Case A mutation after switching to B.

## 5. Test Result

| Command | Result |
| --- | --- |
| `npm test -- --runInBand --no-cache` | 188 passed, 0 failed; 19 suites |
| `npm run build` (backend) | PASS |
| `npx prisma validate` | PASS |
| `npx prisma migrate status` | PASS; 43 migrations current |
| `node --test src/cases/*.spec.cjs src/auth/module-access.guard.spec.cjs src/auth/feature-enforcement.spec.cjs src/auth/access.integration.spec.cjs` | 95 passed, 0 failed |
| `npm run build` (frontend) | PASS |
| `npx tsc --noEmit` | PASS |
| `npx playwright test e2e/case-navigation.spec.ts e2e/case-investigation.spec.ts e2e/cti-phase1-access.spec.ts e2e/asm-phase7.spec.ts --reporter=line --workers=1` | 12 passed, 0 failed |

## 6. Remaining Limitations

- **TI v1 Closure blocker:** None identified in this Phase 1B scope.
- **Production-readiness item:** Live production HTTPS cookie testing remains outstanding; Phase 1 already has automated cookie-option tests and `cti2.md` explicitly excludes live HTTPS testing from this closure.
- **Non-blocking technical debt:** Case-by-ID requests perform a guard lookup and a service lookup. Existing catalog-only entitlements and unrelated controller boundaries remain as reported in Phase 1.

## 7. Final Recommendation

**READY FOR TI V1 CLOSURE.** TI v1 Closure work was not started here.
