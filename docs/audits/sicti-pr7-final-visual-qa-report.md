# PR #7 Phase 4A — final authenticated visual QA

**Date:** 2026-11-16 (Asia/Jakarta)\
**Final visual verdict: VISUAL QA PASS (Phase 4A focused correction, 2026-11-17).** The Correlation score clipping recorded on 2026-11-16 was corrected and reverified at 390 px and 1280 px. The original five-surface run and its evidence remain below as the baseline. PR #7 remains Draft; no commit, push, merge, or deployment was made.

## Phase 4A focused correction — 2026-11-17

The [before screenshot](sicti-pr7-final-visual/correlation-correlations-390.png) shows `90/100` cut off at the card's right edge. The shared mobile `.feed-card header` grid has two columns (`auto minmax(0,1fr)`) even though this Correlation card has only a domain block and a score. A long domain occupies the intrinsic first column, shrinking the score column. Live Chrome geometry also found a zero-width score at 1280 px with the long QA domain, so the same layout cause affected desktop.

The only production files changed for this correction are `frontend/components/intelligence/correlations/CorrelationWorkspace.tsx` and `frontend/app/editorial.css`. The workspace gained a scoped class; its card header now gives the domain `minmax(0,1fr)` and the score an `auto` column at desktop widths. At 600 px and below, the score stacks below the domain. The existing score typography, semantic text, dark SICTI card treatment, and desktop right-hand score position remain intact. The domain can wrap within its own column. No backend service, guard, or migration was changed.

The fresh fixture was created in disposable `cti_corr_qa_sict42` with all **91 existing migrations**. The existing Correlation HTTP integration ran against it, creating Alert `cmwk00yr0001sgpkcaku8bx4h` through `CorrelationQueueService.drainOnce()` and linking it to Case `cmwk00y58001ggpkc4cebgsd2`; its test passed **1/1**. The active `cti` database was not accessed. Chrome signed in through the real login page and checked the persisted Alert and Case IDs through the API and rendered card. The authorized account saw no restricted-module page. The exact Case anchor received keyboard focus, Enter opened `/cases/cmwk00y58001ggpkc4cebgsd2`, and the Case detail displayed its linked Correlation Alert.

| Fresh capture | Score geometry | Layout result |
| --- | --- | --- |
| [Corrected 390 px](sicti-pr7-final-visual/correlation-correlations-corrected-390.png) | 46.48 px rendered width / 46 px text scroll width; inside card bounds; score below domain | Full `90/100` visible, no card-header or document overflow |
| [Corrected 1280 px](sicti-pr7-final-visual/correlation-correlations-corrected-1280.png) | 46.48 px rendered width / 46 px text scroll width; inside card bounds; score right of domain | Full `90/100` visible, no card-header or document overflow |

The [browser assertion record](sicti-pr7-final-visual/correlation-corrected-browser.json) includes the exact IDs, both viewport measurements, and navigation checks. The two PNG files were captured after the final CSS build and visually inspected. Frontend `npm run typecheck` and the final production `npm run build` both passed. The test fixture, temporary credentials, servers, and logs were removed after capture. The score defect is closed; the Monitoring asset-link usability follow-up below remains separate from this focused correction.

## Scope and fixture

This run used one isolated PostgreSQL database, `cti_corr_qa_sict41`, created from the local `backend/.env` connection settings with a different database name. All **91 existing migrations** were applied. The active `cti` database was not accessed. The database was temporarily renamed `cti_soar_qa_sict41` to run the existing loopback-only SOAR HTTP integration against the same persisted Correlation Alert, Case, and Playbook run, then renamed back for browser capture. A synthetic tenant received the required entitlements; its ASM and Monitoring evidence was stored in that same disposable database. Frontend and full backend were served locally at ports 33140 and 33141. Chrome/Playwright signed in through the real login UI; screenshots contain backend records, with no frontend response mocks.

| Record | Persisted ID | Browser use |
| --- | --- | --- |
| Worker-created Correlation Alert | `cmwix117n001sgptss1ndmsek` | Correlation workspace and Case detail |
| Linked Case | `cmwix10wo001ggptsmya7q7ua` | Correlation, SOAR, Monitoring, Case detail |
| SOAR Playbook run | `cmwix11rf0026gptso7ncwdm0` | Verified sandbox run and Case link |
| ASM asset | `cmwix3rgf000egp9cri7sy2rq` | IP asset and service evidence |
| Fingerprint observation | `cmwix3rhd000mgp9cge4rftyd` | OpenSSH 8.4 / TCP 22 context |
| Monitoring finding | `cmwix3rmi0012gp9c8apiv3xi` | Confirmed evidence, watchlist asset ID, linked Case |

The SOAR integration persisted `VERIFIED` with a successful job, `STATE_VERIFIED` event, and receipt using a loopback sandbox action. No real connector or mitigation was activated. The Monitoring source and asset evidence are authorized synthetic QA records.

After the original capture, the disposable database was dropped, the temporary local servers were stopped, and the QA credential file and server logs were removed. That run retained ten PNG captures and three browser assertion JSON files. The focused correction above added two PNG captures and one browser assertion JSON file.

## Browser results

| Route / component | Authenticated assertion | Result |
| --- | --- | --- |
| `/threat-intelligence/correlations` / `CorrelationWorkspace` | Listed worker Alert contains the exact Case ID; its descriptive link was focused and activated with Enter. | Pass |
| `/cases/cmwix10wo001ggptsmya7q7ua` / Case detail | Enter navigation landed on the exact authorized Case and displayed `Linked correlation alerts` with the fixture domain. | Pass |
| `/threat-intelligence/playbooks` / Playbook workspace | API and card both showed `VERIFIED`; card linked to that Case. | Pass |
| `/attack-surface/assets?assetId=cmwix3rgf000egp9cri7sy2rq` / Asset Intelligence Workspace | Populated asset detail displayed SSH port 22, OpenSSH 8.4 fingerprint context, and the matching vulnerability correlation. | Pass |
| `/threat-intelligence/monitoring` / Monitoring workspace | Confirmed finding detail showed evidence, a watchlist with the ASM asset ID, and a link to the same Case. | Pass |

The authorized tenant saw no restricted-module screen. A separate signed-in tenant did not see the fixture domain on Correlation and received 404 when requesting the Case. This checks tenant separation; a dedicated missing-entitlement browser account was not exercised. The Case link is a native anchor with a visible focus target and passed keyboard Enter navigation. Other form and action controls were inspected visually; a full keyboard traversal or screen-reader audit was outside this focused pass.

All ten captures used 1280 px or 390 px Chrome viewports. Playwright measured `documentElement.scrollWidth` equal to the viewport width on every captured page. The responsive layout stacks cards and controls without document-level horizontal scrolling. The `role=alert` elements inspected on the Correlation, Case, ASM, and Monitoring pages had no error text. The SOAR screenshot showed no visible error; its earlier script boolean counted an empty alert role, so it is not evidence of an application error.

## Screenshot inventory

All files below are genuine full-page authenticated Chrome captures; the three adjacent `*-browser.json` files hold record IDs, assertions, capture paths, and layout measurements.

| Surface | 1280 px | 390 px |
| --- | --- | --- |
| Correlation Alert | [Desktop](sicti-pr7-final-visual/correlation-correlations-1280.png) | [Mobile](sicti-pr7-final-visual/correlation-correlations-390.png) |
| Linked Case detail | [Desktop](sicti-pr7-final-visual/correlation-case-detail-1280.png) | [Mobile](sicti-pr7-final-visual/correlation-case-detail-390.png) |
| SOAR verified run | [Desktop](sicti-pr7-final-visual/soar-playbook-verified-1280.png) | [Mobile](sicti-pr7-final-visual/soar-playbook-verified-390.png) |
| ASM asset/fingerprint | [Desktop](sicti-pr7-final-visual/asm-monitoring-asm-asset-1280.png) | [Mobile](sicti-pr7-final-visual/asm-monitoring-asm-asset-390.png) |
| Monitoring finding | [Desktop](sicti-pr7-final-visual/asm-monitoring-monitoring-detail-1280.png) | [Mobile](sicti-pr7-final-visual/asm-monitoring-monitoring-detail-390.png) |

## Defects and limits

1. **Mobile Correlation score clipping — resolved 2026-11-17.** In the original [390 px Correlation screenshot](sicti-pr7-final-visual/correlation-correlations-390.png), the `90/100` score at the right edge of the alert card was clipped. The focused correction and fresh screenshots above show the full value at mobile and desktop widths.
2. **Monitoring asset affordance — usability follow-up.** The watchlist renders `ASM asset cmwix3rgf000egp9cri7sy2rq` as raw text; the finding detail itself has the Case link but no direct asset link. The relationship is visible, but navigation to the asset requires manual lookup. Consider an authorized asset anchor in the watchlist or finding detail and test it across tenants. This was not a blocker for the requested relationship display.
3. **SOAR environment label.** The verified historical run is visible, but the page also says the sandbox connector is disabled because the loopback test server was stopped after the run. This reflects the capture environment, not a failed verified action. The screenshot must not be read as evidence of an active connector.

The five routes use the existing dark SICTI cards, typography, purple action treatments, and stacked mobile layout. The long ASM and Monitoring pages remain readable at 390 px, including the fingerprint and evidence sections. No UX reconciliation branch was modified.

**Next action after Phase 4A:** Continue the separate PR #7 code/security and integration gates before merge review. The Correlation visual correction is complete.
