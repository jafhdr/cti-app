# SICTI V2 frontend reconciliation and integration QA — 31 October 2026

**Verdict: SICTI V2 FRONTEND RECONCILIATION PASS — READY FOR OWNER INTEGRATION REVIEW.** This report records the QA before the local integration checkpoint; no GitHub push/merge, production activation, deployment, active `cti` migration, or edit to the dirty original workspace occurred.

## Baseline and merge

- Branch `integration/sicti-v2-frontend-reconciliation` was created in `.sicti-v2-integration-worktree` from exact checkpoint `60078b2579996c7e68f66597f68ba27a8af2237b`. The original frontend change inventory and SHA-256 values are in `.private-evidence/case13-source-inventory.txt`; the source workspace was read-only throughout.
- Selectively imported the latest five-page UX from `app/cases/{page,layout}.tsx`, `app/threat-intelligence/page.tsx`, `components/intelligence/{IntelligenceData,ThreatIntelligenceShell}.tsx`, the IOC/Threat Actors/Campaigns workspaces, plus `app/reference-ux.css` and `components/ReferenceAccount.tsx`. Root `app/layout.tsx` loads the scoped reference CSS; `DESIGN.md` now records the five-page contract.
- Restored `CaseOperationsPanel` in the redesigned Case page. Preserved the checkpoint `Sidebar.tsx` and `editorial.css` rather than importing the localhost versions that removed two ASM V2 links and review/operations styles. Existing Case P1-A/B/C/D components, backend APIs, permissions and flags remain unchanged.
- Fixed the pre-existing `/threat-intelligence/threat-actors` route collision by excluding its slug from `[section]` static parameters, so the actual redesigned Threat Actors workspace renders. Fixed IOC actions and Campaigns record clipping at 768 px and dark IOC type contrast.

## QA on disposable data

- Backend uses disposable PostgreSQL `cti_sicti_v2_integration_qa_20261031` with normal login and real API data. Case origin/workflow/integrity/reporting and ASM evidence/review/priority/operations flags were enabled only on QA server processes. ASM V2 tenant enrollment was set only in the disposable database. Active environment flags and database were untouched.
- Frontend `npm run typecheck`, production `npm run build` with QA navigation flags, and `git diff --check` passed. Browser tested Case, TI Overview, IOC Candidates, Threat Actors and Campaigns at 1440, 768 and 375 px. All 15 light captures had no page-level horizontal overflow. All five routes were also opened in dark mode. Authenticated checks passed for Case reporting and investigation navigation, ASM Review and Operations screens, IOC Approve and Reject actions, Threat Actors actions, and Campaigns populated and empty states.
- Role and tenant regression: tenant B received 404 for a tenant A Case; a USER was redirected away from IOC review and did not receive its sidebar link. Previous Case12 focused cross-module API and migration QA remains applicable; this pass changed frontend source only.
- Fresh browser artifacts and their SHA-256 manifest are in `.private-evidence/case13-browser/`: 24 PNGs comprising the 15-page/viewport light set, five dark routes, and four additional focused states. Manifest verification found zero hash mismatches and all 15 viewport widths matched. QA-only scripts are retained separately in `.private-evidence/case13-scripts/`. Independent visual re-review passed after the tablet fixes and settled ASM recaptures.

## Evidence and limits

- The 14 pre-existing Case V2 PNGs were copied without modifying their originals into `.private-evidence/case-v2-qa-20261031/`; SHA-256 recheck found zero mismatches. The private ZIP `case-v2-qa-20261031.zip` contains all 14 images, `SHA256SUMS.txt`, and `report-image-map.txt` (16 entries). Neither screenshots nor secrets are committed.
- The original Figma reference images were not available as local files for pixel comparison. UX1–UX8 intent was checked against `DESIGN.md` and the rendered pages; pixel-perfect equivalence is unverified. `reference-ux.css` retains many inherited literal values and overrides, a design-system maintenance risk to address in a later scoped cleanup. The ASM routes retain their existing shell styling; no ASM-wide redesign was requested.
- This result is **frontend integration review readiness**, not production rollout approval. Owner review must still decide active database migration, entitlements, flag rollout, SUPER_ADMIN policy, and the next Git integration action. Re-run the browser set after any subsequent UI merge.
