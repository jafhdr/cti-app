# SICTI Phase 1 correlation pilot — development and QA

**Date:** 9 November 2026\
**Workspace:** `.sicti-flagship-baseline` only\
**Verdict:** Phase 1 implemented and validated in an isolated QA database. No 60-second production SLA claim.

## Delivered

- Tenant-scoped `ThreatEvent` and `ThreatCorrelation` schema, with a new additive migration (`20261109100000_threat_correlation_pilot`). Event fields include source kind/key/name, normalized IOC, IOA kind, provenance, confidence, TLP, observed/ingested timestamps, and unique tenant/source deduplication key. Correlations retain the matching feed observation, score, rule reason, evidence, match/correlation/alert visibility timestamps, and alert reference.
- Admin-only synthetic telemetry endpoint and tenant-scoped analyst read endpoint. The pilot requires both `THREAT_CORRELATION_PILOT_ENABLED=true` and `SICTI_ISOLATED_QA=true`, plus a database name beginning `cti_corr_qa_`; otherwise it returns 404.
- Deterministic exact normalized IOC matching against active, unsuppressed, unexpired URLhaus feed observations within five minutes, with average confidence threshold 70. A match creates an existing-model alert, dashboard notification, and audit record in one database transaction. Source-key replay returns the prior event/correlation rather than another alert.
- Analyst view under Threat Intelligence, using existing shell, cards, forms, and access gate. The view shows score, rule, source, timestamps, TLP, and alert state. The QA form is available to authorized admins.

## Changed Phase 1 files

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20261109100000_threat_correlation_pilot/migration.sql`
- `backend/src/app.module.ts`
- `backend/src/correlation/` (rules, DTO, service, controller, module, unit and integration tests)
- `backend/src/dashboard/dashboard-notifications.service.ts`
- `backend/qa-correlation-fixture.cjs` (disposable browser fixture)
- `frontend/app/threat-intelligence/correlations/page.tsx`
- `frontend/components/intelligence/correlations/CorrelationWorkspace.tsx`
- `frontend/components/intelligence/ThreatIntelligenceShell.tsx`
- `frontend/components/intelligence/feeds/FeedsWorkspace.tsx`
- `frontend/app/editorial.css`
- `frontend/e2e/correlation-pilot-qa.cjs`

Pre-existing ASM V2, Case V2, and baseline reconciliation changes were preserved.

## Validation

| Check | Result |
|---|---|
| Prisma schema validation and client generation | Passed |
| Backend production build | Passed |
| Frontend production build with QA link enabled | Passed; correlation route generated |
| Backend unit regression | 24 suites, 208 tests passed |
| PostgreSQL-backed correlation HTTP integration | Passed; authenticated RBAC, tenant isolation, default-off gate, replay, false positive, expired IOC, delayed event, alert and notification count |
| Authenticated Chrome end-to-end | Passed; real login, UI submission, matched alert shown; desktop and mobile screenshots |

The disposable QA database was migrated and seeded with 77 migrations. No active database was accessed or changed.

## Browser evidence and latency

- [Desktop screenshot](sicti-correlation-pilot-desktop.png)
- [Mobile screenshot](sicti-correlation-pilot-mobile.png)
- One browser run: **265 ms** from click to rendered `MATCHED` state and alert card.
- That same response reported **4 ms** from event ingestion to match/alert timestamp inside the application transaction. These are single-run observations, not percentile or sustained-load measurements. The browser timing includes request, response, and rendering; it does not measure feed acquisition delay.

## Limits

- The telemetry path is synthetic QA input; real internal sensor ingestion is outside Phase 1.
- Matching is exact IOC within a fixed five-minute window and checks only URLhaus-origin observations. It does not infer relationships or correlate IOA sequences.
- The app timestamp for alert visibility is set when the alert is written, before transaction commit. Actual user-visible browser latency was measured separately.
- The notification is addressed to the submitting tenant user; the tenant-scoped correlation view and alert record remain available to authorized analysts.
- No production integrations, automated response actions, or SLA load test were enabled.
