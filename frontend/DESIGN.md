# CTI administration design contract

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
