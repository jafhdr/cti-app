# SICTI Phase 4A — Dark Web & Brand Monitoring Evidence Foundation

**Date:** 2026-11-12\
**Verdict:** **PHASE 4A DEVELOPMENT CLOSED**. This closes the isolated, synthetic evidence foundation. It does not establish live dark-web coverage or authorize production collection.

## Architecture and capabilities

Phase 4A adds a tenant-scoped Monitoring workspace to the existing Threat Intelligence shell. An administrator registers corporate domain, brand, or approved identity-hash watches. Domain watches may reference an existing tenant ASM asset. An existing active Intelligence Source can be authorized as a local `qa-fixture-*` monitoring source; its name and TLP are snapshotted so subsequent catalog deletion preserves provenance while revoking ingestion. The provider-neutral observation contract accepts synthetic credential-exposure metadata, corporate-data indicators, brand impersonation, and phishing-domain signals. Deterministic normalization and matching produce explainable rules, confidence, severity, TLP, provenance, and deduplicated findings. Analysts review findings through NEW, UNDER_REVIEW, CONFIRMED, FALSE_POSITIVE, and RESOLVED states, with append-only review records. Confirmed findings can create or link existing tenant-scoped Alerts and Cases through their services. Deleting an optional Case, Alert, ASM asset, or catalog source detaches its link without deleting monitoring evidence.

The authenticated UI supports watch creation and status, source authorization, finding filters, evidence details, review history and actions, and downstream Alert/Case links. It follows `frontend/DESIGN.md` and the existing editorial tokens.

## Changed implementation and contracts

| Area | Files and contract |
| --- | --- |
| Database | `backend/prisma/schema.prisma`; additive migrations `20261111100000_phase4a_monitoring_foundation`, `20261111110000_phase4a_optional_link_detach`, and `20261111120000_phase4a_source_detach`. Watchlist, source, observation, match, finding, and review tables have tenant keys, unique provider event identity, TLP, retention, and optional downstream links. |
| Backend | `backend/src/intelligence/monitoring.logic.ts`, `monitoring.dto.ts`, `monitoring.service.ts`, `monitoring-links.service.ts`, `monitoring.controller.ts`, and `intelligence.module.ts`; `backend/src/cases/cases.module.ts` exports the existing service. DTOs reject unknown fields. Source authorization requires a tenant-owned active catalog entry. |
| Frontend | `frontend/app/threat-intelligence/monitoring/page.tsx`, `frontend/components/intelligence/monitoring/MonitoringWorkspace.tsx`, sidebar and Threat Intelligence navigation, scoped rules in `frontend/app/editorial.css`, and `frontend/DESIGN.md`. |
| QA | `backend/qa-phase4a-database.cjs`, `qa-phase4a-fixture.cjs`, `qa-phase4a-server.cjs`, `qa-phase4a-browser.ps1`, `qa-phase4a-full-app.spec.cjs`, `backend/src/intelligence/monitoring.logic.spec.ts`, `monitoring.http.integration.spec.cjs`, and `frontend/e2e/phase4a-monitoring-browser.cjs`. |

Domain normalization produces a canonical lower-case domain; brand and domain matching uses deterministic rules including exact-domain, brand-token, and one-edit lookalike signals. Identity watches store a normalized SHA-256 digest and masked label; the observation contract accepts only that digest, never a leaked credential. Observation replay with the same source and provider event key returns the existing record; altered replay is a conflict. Evidence consists of a `qa://` reference and SHA-256 digest, category, observed time, source, and retention time, without raw stolen material. Review transitions require the expected current status and a reason; false-positive findings cannot be reopened by an ordinary review transition. Expired watches do not match. Expired observations are hidden, and the QA hourly scrub clears domain, identity digest, and evidence reference while retaining review history.

## Security and isolation

- Ingestion requires `SICTI_MONITORING_QA_ENABLED=true`, `SICTI_ISOLATED_QA=true`, and a database named `cti_phase4a_qa_*`. The scenario used only disposable `cti_phase4a_qa_20261111`; the active `cti` database was not modified.
- Authentication, tenant and module guards, and ADMIN/SUPER_ADMIN mutation permissions are enforced. Tenant-crossing watch, source, finding, Alert, and Case requests are rejected. USER reads cannot access TLP RED findings.
- Strict DTOs reject plaintext password fields, unsafe evidence URLs, malformed categories, and unknown input. Detail responses omit identity hashes. No live underground endpoint, scraper, production provider credential, or stolen data was used.
- Source deletion revokes future ingest and retains its snapshot. Optional link detachment preserves audit records. TLP and retention are stored with observation provenance; expired evidence is hidden and scrubbed in isolated QA.

## Verification

| Check | Result |
| --- | --- |
| Schema and migration | Prisma schema valid. All **89 migrations** applied in the disposable PostgreSQL QA database; schema up to date. |
| Builds | Backend Nest production build passed. Frontend TypeScript and Next production build passed after the final UI changes. |
| Unit regression | Jest **32 suites / 241 tests** passed, including four monitoring logic tests. |
| HTTP/PostgreSQL integration | Monitoring scenario **1/1** passed: matching categories, tenant/RBAC/TLP, source authorization and deletion, replay/conflict, malformed input, redaction, expiry, false-positive transition, Alert/Case linkage and detachment, and QA-disable gate. |
| Full application | Isolated QA `AppModule` startup and authenticated Monitoring request **1/1** passed. |
| Existing regressions | Phase 1C correlation **1/1**, Phase 2 PostgreSQL **6/6**, Phase 3A **1/1** with its connector flag disabled, Phase 3B/3C connector/recovery **2/2**, Case Management **31/31**, and ASM V2 P1A **1/1** passed in guarded disposable QA databases. |
| Authenticated Chrome | [Browser evidence](sicti-phase4a-browser-evidence.json) **PASS**: tenant watchlist → synthetic observation → match → evidence → analyst confirmation → Alert and Case. Fresh screenshots: [desktop](sicti-phase4a-monitoring-desktop.png) and [390px mobile](sicti-phase4a-monitoring-mobile.png). Functional and visual reviewers approved; notes are in `.omo/evidence/phase4a-monitoring-manual-qa.md` and `.omo/evidence/phase4a-monitoring-clone-fidelity.md`. |
| Diff hygiene | `git diff --check` passed. |

## Limits and Phase 4B recommendation

This foundation uses only synthetic fixtures and `qa://` evidence references. It provides no live source coverage, external evidence resolver, provider callbacks, collection schedule, delivery-latency claim, or production purge worker. The deterministic scores are explainable but not calibrated against real provider data. The normalized identity SHA-256 digest is suitable only for isolated QA: predictable identities could be guessed offline; a production contract needs a keyed, tenant-aware digest and key rotation. The UI currently caps list retrieval at 100 items.

**Phase 4B recommendation:** integrate only explicitly authorized providers and corporate identifiers, with provider-specific legal scope, least-privilege credentials, authenticated transport, source provenance and TLP mapping, encrypted evidence handling, keyed identity matching, retention/deletion jobs, rate and replay controls, coverage/latency metrics, and staged tenant-isolation tests. Do not infer production readiness from Phase 4A synthetic results.
