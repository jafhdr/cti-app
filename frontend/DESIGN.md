# CTI administration design contract

## IOC lifecycle safety

The existing Indicators workspace shows effective eligibility beside the persisted lifecycle status. Its detail context contains expiry, current analyst suppression, a reason-required decision control and append-only history. False positive, safelist, inactive and expired use distinct text labels. Confirmation precedes each decision, pending disables submission, and errors remain visible. The section inherits existing `--soc-*` tokens and stacks controls on mobile. It is exposed only when the local IOC lifecycle flag is enabled after schema activation.

## Feedback follow-ups

The Reports workspace places an accountable feedback queue and tracked actions below analysis reports. PIR and SIR details show the same bounded context, while Received Reports show only the author's follow-up status and update time. The surface reuses `--soc-*` colors, shared cards and buttons, and existing editorial type. Scoped `--follow-*` tokens set 8px copy spacing, 12px action spacing, 16px record spacing, 24px section gaps, 32px outer space, and a 720px form maximum. SIR association is named as explicit; absence means report and PIR feedback only. A labeled checkbox records a need for a new PIR or SIR without creating one. At mobile width controls stack and text wraps within the viewport. Status always has a text label.

## CTI effectiveness metrics

Threat Intelligence Overview includes a read-only operational metrics section below the established intelligence summary. It reuses the editorial `--soc-*` palette, display type, quiet border, and existing 18px surface radius. Four KPI cards lead into two-column workflow sections; tablet uses two KPI columns and mobile stacks cards and controls. Scoped `--effect-*` tokens set the 16px card gap, 24px section inset, 48px section separation, 40px controls, 13px labels, 12px notes, 14px status headings, 24–36px KPI scale, 7px status bars, and the #5946b9 action surface with white ink in both themes for readable button contrast. Every ratio shows its numerator and denominator, missing samples say “Not available,” and status bars retain numeric labels so color is supplementary. Stakeholder feedback patterns use compact category rows with distribution, view, response counts, and response rates, never recipient or free-text details. Restricted, loading, empty, and error states share the same surface treatment.

## Intelligence traceability

Read-only SIR, Collection Task, and analysis-report trace sections reuse the existing editorial card, border, text, and link palette. The `intelligence-trace` surface adds only scoped spacing and card geometry over `--soc-*` colors. Relationship labels separate analyst-selected citations and frozen report content from current task associations. Restricted report details display a text state with no report metadata. Lists wrap at mobile width and use the existing pagination control.
The scoped trace spacing tokens are 8px copy, 12px list gap, 20px pager, and 24px section separation; list cards use 12px vertical and 16px horizontal padding with a 12px radius. When synchronized lists have different lengths, later pages say that the shorter list has no items on this page rather than implying its relationships do not exist.

## Requirement coverage

PIR and SIR workspaces use a read-only coverage section within the existing editorial surface. It derives workflow facts and named operational gaps from persisted records; counts never imply analytical quality. The section reuses `--soc-*` colors, with scoped 12px gaps, 24px section spacing, 16px card padding, 12px radius, and 13px signal labels. At mobile width filters stack, cards wrap, and links remain visible. Restricted report and feedback context appears as text without counts or metadata.

## Analyst assessments

The existing source detail and SIR evidence cards display separate source reliability and information credibility assessments. An unassessed state remains explicit. Assessment cards reuse `--soc-*` colors, a 12px radius, 16px inset padding, 12px form gaps, native labeled inputs, and shared Button controls. Mobile headings stack above actions. Historical registry grades are labeled as legacy facts rather than treated as authored assessments; current assessments show rationale, assessor, and time. Report confidence remains a separate concept.
When an assessed source is deleted or assessed evidence is detached, the relevant workspace displays the archived assessment in place with immutable original IDs and captured factual context. Historical cards do not offer a new assessment action or a broken link to the deleted operational record. History uses the existing ten-record page limit and shared button styling.

## UI consistency (ui.md)

Paired landing actions place secondary Explore Platform before primary Get Started. Sidebar theme preference uses three labeled icon buttons for Dark, Light, and System while retaining `cti-theme`. Single-choice selects reserve 36px for text and render a themed chevron 15px from the right edge; multiple selects keep their native list behavior. Secondary operational labels use a readable 12–13px scale, with compact landing preview labels at 9–11px on mobile. Existing heading sizes and responsive layout remain the baseline.

## Typography scale (font.md)

The existing Webtrix display face, colors, and layout remain in use. Authenticated page headings use a responsive 28–48px scale, dashboard hero text caps at 64px, section headings use 24–36px, and the visual dashboard and module figures cap at 84px. Operational KPI, body, label, table, navigation, and button text keep their compact existing scale when already proportionate. The public landing headline caps at 64px and its section headings at 48px. Keep tight display tracking and a readable line height as the type scales down.

## 11. Editorial transformation (lpdb3.md)
The authenticated experience moves toward a premium editorial cybersecurity product. The shell uses a floating 268px navigation surface, a framed main canvas, generous content gutters, and large display headings. The dashboard uses a two-part hero with a live summary visualization, a typographic metric strip, and unequal editorial story panels. The visualization uses the dashboard API summary; no unavailable time series or asset counts are invented.

Shared implementation tokens are in `app/editorial.css`: `--cti-display`, `--cti-radius`, `--cti-space`, `--cti-glow`, and the semantic `--soc-*` dark and light palettes. Main surfaces use 18–30px radii, quiet 1px borders, restrained layered light, and a purple-indigo action color. Light mode uses its own cool paper palette and softer ambient light. Navigation, buttons, cards, tables, headings, and fields inherit the system across authenticated modules. Desktop keeps a floating sidebar; tablet and mobile stack navigation above the main surface. Reduced motion remains supported.

The earlier preservation language describes previous phases. This section supersedes its visual constraints for the lpdb3 transformation while preserving access, data, and workflow behavior. Remaining debt: module-specific compositions and landing storytelling need further visual restructuring and browser QA.

## 1. Scope
Preserve the existing SOC administration component system for Subscription, Module Management and Akses Modul. No visual redesign or additional runtime dependencies.

## 2. Color
Use the existing `--soc-*` tokens in `app/globals.css`: canvas, surface, elevated, border, ink, body, muted, blue, green and red. Status always has text as well as color.

## 3. Typography
Preserve the system font stack and current heading, body and small-text styles. Module names and policy labels must wrap.

## 4. Layout
Preserve `.app`, `.main`, `.content`, existing cards, tables and responsive rules. Administration forms use their current spacing. Mobile content must not overflow the viewport.

## 5. Primitives and states
Reuse Button, native labeled checkboxes/selects, status pills, feedback regions, module cards and the access panel. Loading uses role=status; errors remain actionable; empty lists explain the absence. Disabled grants have a visible reason. Assigned and Accessible are separate states. Confirm revocation or policy disabling with the browser confirmation dialog. Save disables controls while pending.

## 6. Access terminology
Subscription: Module Included. Policy: Global Module, Tenant Enabled, Role Access. Assignment: User Assigned, Feature Access. Effective result: Accessible. Role policy eligibility explicitly excludes user assignment; individual Accessible always comes from the backend. Empty feature keys mean no assigned features.

## 7. Motion and accessibility
Keep existing 150ms transitions and focus outlines. Native controls remain keyboard accessible. Reasons and statuses must be readable without hover. Do not add motion.

Dashboard Notification Bell is a nonmodal dialog popover: background controls remain reachable, Tab follows document order, Escape restores Bell focus, and a removed read action returns focus to Close. Its preview and action text mix the existing muted/blue tokens at 80% with the ink token to maintain contrast on unread surfaces. Unread changes use a polite status region. No new motion is introduced.

## 8. Accepted debt and verification
Existing screen layout and dependencies remain in scope; generalized design-system migration and performance tooling installation are outside this authorization fix. Verify desktop, tablet and mobile with fixture-backed browser scenarios and retain screenshots under `.omo/evidence/3menu`.

Administration navigation at widths up to 900px wraps module groups and submenu links within the available width. These three menus do not require horizontal scrolling to reveal navigation labels.

## 9. Public experience extension (lpdb.md)
The public landing page uses the existing CTI workspace as product proof and introduces no fabricated customer metrics, prices, or live data. Its visual language is original: near-navy canvas, layered indigo and blue light, illuminated violet calls to action, restrained bordered cards, and a typographic hero. The illustrative workspace preview is explicitly labeled.

Tokens for the public surface live under `.lp` in `app/landing.css`: `--lp-bg`, `--lp-surface`, `--lp-line`, `--lp-ink`, `--lp-muted`, `--lp-accent`, and `--lp-blue`. Display text uses a tight letter-spacing scale and the existing Inter fallback stack. The layout uses a 1200px content width, 12–24px radii, roomy section spacing, and modest 200ms hover elevation. Buttons, cards, preview panels, FAQ details, and mobile disclosure navigation are reusable native patterns. Focus indication inherits the application rule; reduced-motion disables transitions. Below 1000px the hero stacks; below 700px navigation becomes a disclosure and all feature sections stack. The public page remains usable without API access.

The earlier administration preservation rules still apply to those screens. A broader authenticated visual migration remains separate because many existing pages have independent style rules and user work in progress.

The authenticated shell now inherits the navy, indigo, border, text, and surface ramp through `--soc-*` in `app/soc-theme.css`. Sidebar, top bar, cards, metrics, and authentication surfaces share the same color story as the landing page. Existing page-specific layouts and module access logic are retained.

## 10. Phase 2 foundation
Dark is the default. The root theme provider applies a saved Dark, Light, or System preference on every route and tracks operating system changes in System mode. Light uses the same semantic `--soc-*` tokens as dark. The application sidebar keeps module visibility tied to `accessible`, provides a mobile disclosure, and retains the existing submenu hierarchy. Dashboard command cards distinguish available summary metrics from data the API does not expose; quick links follow accessible modules. The shell uses rounded surfaces, clear focus indicators, and reduced-motion behavior from the shared theme. Accepted debt: individual module pages still contain independent hardcoded colors; their deeper redesign belongs to later phases.

## 12. Authenticated module composition (lpdb4.md)
ASM, threat intelligence overview, indicators, cases, administration, and subscription use the shared editorial module hierarchy. `.editorial-heading` carries the page statement, `.editorial-metrics` carries only values derived from loaded API data, `.editorial-feature` provides context or an API-backed overview, and `.editorial-section-heading` introduces the operational table or workflow. The asset type overview labels its counts as current-page counts because the asset API response exposes only the current page; total assets uses the API total. Case counts by status and indicator counts by severity likewise describe the loaded page or result set.

Module views retain their existing API requests, tenant selectors, permission checks, and CRUD controls. Empty values display zero or the existing empty state. The dark and light palettes use `--soc-*`; type scale and responsive spacing use the `--cti-*` contract. The metrics collapse to two columns at tablet width, feature compositions stack, and the asset type map becomes one column on mobile. Operational tables remain available and scroll within their own surface where needed. Light theme restores readable navigation branding.

## 13. Threat intelligence Phase 2A
Threat Actors and Campaigns use the authenticated editorial hierarchy: a statement heading, API-backed summary strip, operational directory, and profile-led detail panel. Styles are scoped under `.ti-phase2a` in `app/editorial.css`. The `--cti-ti-*` tokens define workspace widths, heading and body type scales, spacing, radii, and on-action contrast; the 900px card breakpoint follows the authenticated shell breakpoint. They inherit `--soc-*` and `--cti-*` tokens for dark, light, and system themes. At 900px and below, directories become labeled stacked records so no wide table is forced into the viewport. Total counts come from the list response; status, confidence, severity, and actor counts derived from the loaded page are explicitly labeled as current-page values. Unknown campaign counts display “Not available.” Relationship links navigate only when an actual returned relationship exists. The API does not provide a discrete activity-event history, so no event timeline is inferred from timestamps.

## 14. Threat intelligence Phase 2B
Sources, feeds, reports, and MITRE use the existing `--soc-*` palette, `--cti-*` spacing and typography, editorial metric strip, and operational directory. A section label precedes each directory. Summary values derived from a paginated response are labeled “on this page”; only the response total describes the full directory. Feed status counts describe returned providers. Source sync, feed cooldown, report author, and MITRE actor or indicator mappings are omitted where the API has no field. At 900px, operational rows become labeled cards; feed cards stack within the viewport. Detail and form panels retain the existing accessible controls and status text. No secret is included in the source DTO or rendered by these pages.

## 15. Administration Phase 1
Administration uses the existing authenticated editorial palette and shell. A compact page heading, API-backed metric strip, labeled filter bar, directory, and inline detail panel form the workspace. The same `--soc-*` color ramp and `--cti-*` spacing drive dark, light, and system themes. Administration-only layout rules are scoped under `.admin-workspace`; directory cards use the existing surface, border, and action treatments.

Reusable primitives: `.admin-heading` (eyebrow, display title, supporting copy), `.admin-filter` (visible label and native control), `.admin-directory` (table on desktop, labeled record cards at 900px and below), `.admin-detail` (selected identity and grouped facts), and `.admin-state` (loading, empty, error, forbidden). Controls retain focus outlines, text status, and browser confirmation for disabling access. User assignment and effective accessibility remain separate fields sourced from the backend. The organization label is used for presentation while API names and tenant IDs remain unchanged. At 375px forms and actions wrap into a single column; no directory requires horizontal scrolling.

Accepted debt: the backend has no standalone detail endpoints, last-activity metric, or per-module user/organization counts. Detail panels use the selected list record and existing access endpoints. Missing metrics display “Not available.” Live tenant-isolation QA requires valid tenant credentials.

## 16. Modal and drawer foundation (pop.md)
Shared overlays use the existing `--soc-*` palette and `--cti-radius` editorial surface. Dialogs are centered, bounded by the safe viewport, and keep header and footer visible while the body scrolls. Drawers enter as right-side context panels on desktop and bottom sheets at mobile width. Both use an accessible title, optional description, focus containment and return, Escape, and background scroll lock. Buttons use the existing shared Button treatment. The foundation does not change feature forms or routes; feature migration follows separate review.

## ASM Phase 5 discovery history
Asset Detail reuses the existing intelligence section, metric strip, outlined buttons, and `--soc-*` surfaces for discovery scheduling and change history. The schedule control wraps at desktop and stacks at 640px. Status and change categories use explicit text labels; time, prior/current values, provider/run source, and failed counts remain visible without hover. Loading, empty, and error states use the existing status and alert patterns. No new color or typography token is introduced.

## ASM Phase 6 alerts
Asset Detail uses the existing intelligence section, metric strip, severity badge, outlined button and `--soc-*` surface for alerts. Alert metrics count loaded records for the selected asset. Status and severity remain text labels, actions wrap on narrow screens, and loading, empty, and error states use existing accessible patterns.

### ASM Phase 6b risk posture

The Asset Intelligence workspace uses its existing intelligence section, heading, metric grid, and context text for a compact risk history summary. A missing baseline names the discovery action that creates one. The score uses active findings only (critical 8, high 4, medium 2, low 1); the UI displays the persisted current and previous snapshots and their trend.

## ASM Phase 7B notification preferences
The Posture Report uses the existing `asm-intelligence-section`, `asm-section-heading`, and `asm-schedule-controls` primitives for notification settings. Channel is shown as disabled In-App because no external destination is configured. ADMIN and SUPER_ADMIN can change Enabled and HIGH/CRITICAL threshold; USER sees read-only values and a permission explanation. Loading, saved, and error feedback use existing status and alert treatments. At mobile width, controls stack using the ASM schedule breakpoint; no new design tokens are required.

## 17. AppSec Application Inventory (Phase 3)

The AppSec workspace uses the established authenticated editorial shell and semantic `--soc-*` palette. Its Applications page follows the statement heading, API-backed metric strip, filter bar, and operational table hierarchy. Total applications comes from the paginated API; Active and Critical counts explicitly describe the current page. The detail page uses bordered identity facts and a separate deployment context section. Asset data appears only when the user has ASM `asset-management` access; absent access is stated without exposing Asset names or counts. Application remains usable without ASM.

The existing FormModal and Dialog primitives handle create/edit and Asset selection. New controls retain native labels, keyboard focus, loading, empty, error, retry, and read-only states. At 900px detail facts become two columns; at 640px forms, filters, actions, and facts stack. No new palette, font, or motion token is introduced. The tenant selector begins unselected for SUPER_ADMIN, and switching tenants remounts tenant-scoped content before fetching the new workspace.

AppSec component tokens are scoped under `.appsec-workspace`: spacing steps 8/12/16/24/36px (`--appsec-space-xs` through `--appsec-space-xl`), surface radii 14/18px, operational label/body sizes 12/16px, and a 24–32px section heading. Filter minimum widths 250/180px and the picker scroll limit 360px are layout constraints. These values reuse the authenticated editorial scale and inherit all color, display-font, motion, and breakpoint decisions from `--soc-*` and `--cti-*`.

## 18. AppSec Findings and posture (Phase 4)

The AppSec shell owns the selected tenant and independent route gates: `posture-overview` for `/appsec`, `application-inventory` for `/appsec/applications`, and `finding-management` for `/appsec/findings`. Its keyed workspace remount clears list, detail, and overview state on tenant changes. The sidebar shows only the features granted to the current user.

Overview shows current tenant counts from `/appsec/posture`: Applications, active Findings, Critical, High, and Resolved / Closed. “Resolved / Closed” combines `RESOLVED`, `ACCEPTED_RISK`, and `FALSE_POSITIVE`. The severity and status bars are current-state distributions; the top Application list is ordered by critical, high, then all active Findings. There is no score or inferred time trend.

Findings reuse the authenticated editorial heading, metrics, table, modal, facts, and status language. Forms expose manual input only. The detail offers backend-valid lifecycle transitions; terminal decisions require a resolution, and reopening clears the active resolution while audit history remains. The shared `--appsec-*` spacing, type, and radius tokens from §17 also drive distribution cards, remediation facts, and the transition panel. Narrow viewports stack cards and fact columns while preserving readable labels.
## 19. SICTI public reference (uiux.md)
The supplied landingpage.pdf and login.pdf govern the public landing and login surfaces. Public tokens live under .lp in landing.css and .sicti-login in login.css, separate from authenticated --soc-* styles. Use a white canvas, blue #0864ff actions, black serif section titles, compact sans-serif body text, blue gradient workflow panels, and the reference section order. The landing uses a two-column feature primitive and responsive single-column layout below 700px. Login uses a centered white card on a pale radial background; credential submission remains the existing /auth/login request. Google Sign In is displayed as reference art only because no provider integration exists. The reference PDF contains flattened raster pages, and no clean hero photograph is available in the supplied assets. The temporary blurred screenshot crop was removed; exact hero fidelity is blocked pending the original image.
## 20. Landing desktop regression (uiux3.md)
The 783px PDF raster is a layout reference, not the desktop max-width. Landing containers now use 87% of the viewport up to 1400px and scale type, section spacing, panels, and hero height above 783px. The original photograph remains unavailable in the supplied flattened PDF and design board. The hero is left unfilled rather than showing a fabricated image or black replacement; exact hero fidelity remains blocked pending the source asset.
## 21. Hero reference background
The user accepted the blurred crop from the supplied landing reference as the available hero background. The public hero uses that crop with a dark readability overlay until a clean source photograph is provided.
## 22. Landing hover states and footer (uiux4.md)
The four capability articles use the established workflow blue on hover, with white type and icons. Asset relationship steps use a dark blue hover fill. Access cards retain their white surface and shadow while gaining a blue border. These color transitions last 200ms and are disabled when reduced motion is requested. The footer shows Facebook, Instagram, LinkedIn, and TikTok icons and the contact email ptsisi@sisi.sig.id.

## 23. Landing scroll reveal (animasi.md)
The public SICTI landing reuses LandingMotion from commit a9a7e7f. IntersectionObserver reveals marked headings, capability cards, feature copy and panels, asset steps, workflow steps, access cards, pricing, FAQ, and CTA once at threshold 0.12 and bottom root margin -30px. Opacity and transform transition for 700ms using up, left, right, scale, and fade states; repeated cards use 80/160/240ms delays. Existing blue hover states retain their color, border, and shadow transitions. Content stays visible without JavaScript, observer support, or when reduced motion is requested.

## Dashboard visual refinement Phase 1 (db2.md)
Dashboard styling is scoped under .dashboard-page in app/dashboard-visual.css. Light mode uses the supplied uiux/db.png blue canvas, white rounded surfaces, blue outlined actions, and electric-blue workspace panel. Display headings and KPI figures use the existing Times New Roman serif family already used by the SICTI landing page; operational text retains the existing sans-serif family. Dark and System preferences continue to resolve through ThemeProvider, with dashboard-local dark surface tokens. Responsive layouts retain the 900px sidebar disclosure and 640px card stacking; all role and entitlement conditions remain in the page component. The reference's search, notification, and avatar art is not implemented because these are new features outside the approved visual scope.

## Dashboard reference fidelity continuation (db3.md)
The dashboard-only Sidebar presentation shows Lucide icons on visible module headings, an Overview label with the existing Dashboard accessible name and route, and two visible explicit theme choices. A stored System preference remains supported by ThemeProvider and resolves to the active Gelap or Terang control. Other routes keep the original three-choice Sidebar. Dashboard profile initials and tenant table initials derive from existing names. The header uses the existing logout action and no search or notification control without a reusable Dashboard contract. The Dashboard h1 remains semantic while its mode and tenant context appear in the header. Existing Risk Posture and Workflow cards retain their place between KPI and coverage. The hero remains two columns down to the 900px shell breakpoint, then stacks. All visual rules remain under .dashboard-page; the serif family is the existing Times New Roman used by the public SICTI landing page.

## Tenant Management reference fidelity (db4.md)
The attached 2880×1800 Tenant Management screenshot defines the target: a pale blue canvas, floating white sidebar and topbar, six icon-bearing main navigation headings where effective access permits, a two-choice theme footer, serif organization heading, four independent white KPI cards, and a rounded white directory table. Tenant Management uses the existing Dashboard Sidebar presentation only on this route, with `/auth/me` module access and identity. Colors inherit the existing `--soc-*` and Dashboard blue tokens; page-specific surface, radius, spacing, and typography rules live under `.tenant-management-page` in `app/tenants/tenant-management.css`. The existing FormModal and ConfirmationModal retain their behavior and receive scoped visual alignment. On tablet/mobile the KPI grid becomes two columns, and the table remains horizontally scrollable with all actions available. The screenshot contains a notification icon without an existing shared function; no inert notification control is added.

## User Management reference fidelity (db5.md)
The attached User Management screenshot defines the target for `/users`: pale blue page canvas, floating white Sidebar and identity header, serif page title, four independent KPI cards, one Search & Filter surface, and one User Directory surface with a muted table header. Use the existing SharedSidebar `dashboardPresentation` with `/auth/me` effective module access, and preserve the ADMIN/SUPER_ADMIN gates and tenant scope. Existing `--soc-*` and Dashboard/Tenant blue tokens drive a route-scoped `.user-management-page` stylesheet; no global style or font changes. Search, organization, role, status, and reset stay combined. The current directory contains View, Edit, Reset PW, Module Access, status, and role controls, so all remain exposed; a single Manage access action and pagination require separate workflow/data-flow approval. Narrow screens use labeled records with all controls visible. The reference bell has no reusable notification behavior and is omitted.

## Module Management reference fidelity (db6.md)
The supplied full-page Module Management screenshot defines the visual target for `/modules`. The page uses the existing Sidebar in `dashboardPresentation` mode with effective module access from `/auth/me`, a route-scoped pale-blue canvas, a rounded identity header with functional logout, a Configured tenant surface, four independent API-backed KPI cards, and a two-column policy grid. The existing `--soc-*` color contract is adapted locally through `.module-management-page` tokens in `app/modules/module-management.css`; no global palette, font, or backend policy rule changes. Each policy card preserves the backend-evaluated distinction between inclusion, subscription, global activation, tenant enablement, role eligibility, and user assignment. The existing custom-module action retains its create meaning and therefore keeps the label `Tambah modul` instead of the reference's `Tenant modules`. The notification bell has no shared functionality and is omitted. Tablet and mobile collapse the policy grid without hiding controls.

## Subscription reference refinement (db7)

The Subscription route uses the shared Administration sidebar in dashboard presentation and a scoped `subscription-shell`. Its pale canvas, floating white surfaces, blue current-plan panel, compact capability rows, and three-column package grid are defined in `app/subscription/subscription-visual.css`. Route aliases map surface, ink, muted text, and borders to shared `--soc-*` tokens. At 900px package cards become two columns; at 700px the shell and cards stack. The route keeps light and dark theme control, and all prices and entitlements come from existing subscription responses.

## Audit Log reference refinement (db8)

The Audit Log route uses the shared Administration sidebar in dashboard presentation and scoped `.audit-log-shell` styles in `app/audit-logs/audit-log-visual.css`. Its palette aliases shared `--soc-*` tokens, with semantic role and activity badges. Global SUPER_ADMIN view shows Tenant as a fifth column; tenant-scoped views use four columns. At 900px and below, the table becomes stacked cards with all fields retained. Pagination remains server-driven, and metadata remains a read-only native disclosure.

## AppSec reference refinement (db9)

Four supplied AppSec screenshots define the light desktop contract for Overview, Findings, standard detail, and integrated detail. The existing `--soc-*` palette and AppSec component tokens are adapted through a route-scoped `.appsec-shell` layer in `app/appsec/appsec-reference.css`; no global style changes are required. The shell uses a pale-blue canvas, a floating white Sidebar and identity topbar, and the existing serif display family for page titles. The Sidebar dashboard presentation exposes explicit Light and Dark controls while preserving the stored System theme. The topbar uses actual `/auth/me` name, email and role and the existing logout request; no decorative notification control is added.

AppSec primitives are five independent KPI cards, two distribution cards with semantic bars, a compact top-application row, a directory filter/table card, a three-column fact grid, and grouped remediation/integration panels. Semantic severity and status labels remain textual. Overview values come only from `/appsec/posture`; finding totals and page counts come from the paginated response. Top-application identifiers are shown only when supplied by the API. AppSec applications, forms, dialogs and confirmation surfaces inherit the same scoped card, field and action tokens. At 900px the shell stacks and tables become labeled rows; at 640px KPI, fact and integration grids become one column. Dark tokens preserve contrast without changing the global theme default. The reference bell is omitted because no notification action exists.

## Dashboard Search and ASM Bell (db11)
The Dashboard alone adds a right-aligned white search pill below its floating topbar and a functional bell before the avatar. The pill uses existing Dashboard --db-surface, --db-blue, --db-border and rounded action tokens; its blue circular button has an accessible Search label. The bell uses the same surface and focus treatment, with a bounded popover showing real ASM alerts, severity, time and per-user read state. SUPER_ADMIN selects an explicit tenant before either control queries data. Search and bell clear stale results on tenant changes. At 768px the controls wrap without hiding results; at 375px the search takes full width and the popover stays within the viewport. Dark mode inherits --db-* aliases. No other page receives these controls.

## Unified Dashboard Bell (db16)
The Dashboard Bell displays ASM, Case, AppSec and TI with text source labels, optional priority, safe preview, timestamp and per-user read state. It retains the db11 surface, radius, spacing, focus and responsive tokens. Source labels use --db-blue; preview uses --db-muted at 12px with 1.5 line height. Tenant sessions clear data by remounting, abort requests and reset counts. Opening refreshes access, Escape restores trigger focus, Tab stays within the popover, and navigation revalidates the destination through the authorized read endpoint. Errors remove stale counts; no new page or source filter is introduced.
Pagination reuses a server snapshotAt boundary while the popover remains open; reopening starts page one with a fresh snapshot. Compact timestamps use day/month/hour/minute at mobile sizes, with full time preserved in title and datetime attributes.

## 14. PIR Management V1

The PIR workspace follows the existing Threat Intelligence editorial shell. It uses `--soc-*` semantic colors, shared Button and FormModal primitives, a compact requirements directory, a profile detail card, and text-backed priority/status indicators. Lifecycle actions appear only for permitted next states and are available only to authorized editors. Filters wrap on tablet and stack on mobile; profile facts and the edit form collapse to one column below 700px. Focus and reduced-motion behavior inherit the shell. Stakeholder links connect the two governance workspaces without changing the shell or creating a new top-level module.

## SIR Management V1
- Reuses the PIR editorial workspace, cards, priority chips, form modal, and responsive two-column detail grid.
- The PIR detail shows linked SIRs, exact status counts, and an Add SIR deep link. The dedicated SIR workspace offers parent, priority, status, search, sort, and pagination controls.
- Analyst answers use a separate modal. Answered status is unavailable until a nonblank answer is recorded. USER sees a read-only workspace.

## Collection Planning V1

The Collection workspace extends the Threat Intelligence editorial shell. Its scoped `--collection-*` variables alias the shared `--soc-*` palette and govern card surface, border, focus, ink, radius, and spacing. The task list, filter controls, detail facts, and form reuse the established PIR layout primitives; collection cards add a visible selected state and an `aria-expanded` relationship to the detail. Shared Button and FormModal controls remain the action primitives. The SIR collection section reuses the bounded evidence-section layout. At 700px the filters, cards, detail facts, and form stack into one column.
