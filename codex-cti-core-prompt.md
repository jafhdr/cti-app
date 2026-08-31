
# INSTRUCTION: Build CTI Core Module for CTI App

You are working on a Cyber Threat Intelligence (CTI) web application with:
- **Backend**: NestJS + Prisma (PostgreSQL), located in `backend/`
- **Frontend**: Next.js + Tailwind CSS + shadcn/ui, located in `frontend/`
- **Repo**: https://github.com/jafhdr/cti-app
- **Existing schema**: `backend/prisma/schema.prisma` — check it for existing models and naming conventions

## Your Mission
Build the **CTI Core module** — the full foundation of the application. Nothing else matters until this is done.

The eight entities and their relationships:

---

### 1. Source / Feed (sumber intel)
Represents a threat intelligence source or feed: commercial feeds, open-source feeds (OSINT), internal research, partner-sharing, dark web monitoring, honeypot/moloch output, etc.

**Fields:**
- `id` (UUID, PK)
- `name` (string, required) — e.g. "AlienVault OTX", "Internal Dark Web Monitor", "Partner ISAC Feed"
- `type` (enum: `FEED`, `SOURCES`, `INTERNAL`, `PARTNER`) — categorical source type
- `description` (string, nullable)
- `url` (string, nullable) — source homepage or feed URL
- `isExternal` (boolean, default false) — apakah external feed
- `isActive` (boolean, default true) — enabled/disabled
- `createdAt`, `updatedAt` (DateTime, auto)
- `createdBy` → User (optional relation, nullable FK)

**Relations:**
- One Source → many Intelligence Reports (1:N)
- One Source → many Cases (many-to-many via join table `CaseSource`)

---

### 2. Threat Actor
Represents a threat group, actor, or individual: e.g. APT29, Lazarus Group, FIN7, ransomware-as-a-service operators.

**Fields:**
- `id` (UUID, PK)
- `name` (string, required) — primary name
- `aliases` (string[], nullable) — alternate names, e.g. ["Cozy Bear", "The Dukes"]
- `description` (string, nullable)
- `sophistication` (enum: `NONE`, `LOW`, `MEDIUM`, `HIGH`, `SUCCESSFUL`, nullable)
- `operationalPrivacy` (enum: `THREAT_ACTOR_OPERATIONAL_PRIVACY_PUBLIC`, `THREAT_ACTOR_OPERATIONAL_PRIVACY_PRIVATE`, `THREAT_ACTOR_OPERATIONAL_PRIVACY RESTRICTED`, nullable)
- `primaryMotivation` (enum: `NONE`, `CRIMINAL`, `EW`, `ESPIONAGE`, `HACKTIVISM`, `SABOTAGE`, `UNKNOWN`, nullable)
- `isAnonymous` (boolean, default false)
- `isObserved` (boolean, default false) — whether observed by org
- `createdAt`, `updatedAt` (DateTime, auto)
- `createdBy` → User (nullable FK)

**Relations:**
- One Threat Actor → many Intelligence Reports (1:N)
- One Threat Actor → many Campaigns (1:N)
- One Threat Actor → many Indicators (1:N, via join: threat actor uses indicator)
- One Threat Actor → many Malware/Tools (N:M via join table `ThreatActorMalware`)
- One Threat Actor → many Cases (many-to-many)
- One Threat Actor → many Targets (N:M via join table `ThreatActorTarget`)

---

### 3. Campaign
A coordinated operation or campaign run by a threat actor.

**Fields:**
- `id` (UUID, PK)
- `name` (string, required)
- `description` (string, nullable)
- `status` (enum: `NOT_DEFINED`, `NEW`, `ON_GOING`, `COMPLETED`, `ABANDONED`, default `NOT_DEFINED`)
- `firstSeen` (DateTime, nullable)
- `lastSeen` (DateTime, nullable)
- `createdAt`, `updatedAt` (DateTime, auto)
- `createdBy` → User (nullable FK)

**Relations:**
- One Campaign → many Intelligence Reports (1:N)
- One Campaign → one Threat Actor (N:1)
- One Campaign → many Malware/Tools (N:M via join table `CampaignMalware`)
- One Campaign → many Indicators (N:M via join table `CampaignIndicator`)
- One Campaign → many Cases (many-to-many)

---

### 4. Malware / Tool
Represents malware families, tools, TTPs, attack techniques.

**Fields:**
- `id` (UUID, PK)
- `name` (string, required)
- `type` (enum: `NONE`, `ABUSE_MATERIAL`, `ACTIVITY`, `BACKDOOR`, `CONTROL_SERVER`, `DATA_DESTROYER`, `DATA_EXFILTRATOR`, `DATA_ENCRYPTOR`, `DATA_TROVE`, `DDOS`, `REMOTE_ACCESS`, `TYPO_SQUATTING`, `VULNERABILITY`, `WEAPON`, `UNKNOWN`, default `NONE`)
- `description` (string, nullable)
- `isSigned` (boolean, default false)
- `isCommercial` (boolean, default false)
- `isOpenSource` (boolean, default false)
- `createdAt`, `updatedAt` (DateTime, auto)
- `createdBy` → User (nullable FK)

**Relations:**
- One Malware/Tool → many Intelligence Reports (1:N)
- N:M with Threat Actor (via `ThreatActorMalware`)
- N:M with Campaign (via `CampaignMalware`)
- One Malware/Tool → many Indicators (1:N via join)
- One Malware/Tool → many Cases (many-to-many)

---

### 5. Vulnerability / CVE
CVE records, zero-days, known vulnerabilities associated with threats.

**Fields:**
- `id` (UUID, PK)
- `name` (string, required) — e.g. "CVE-2024-1234", or custom vuln name
- `description` (string, nullable)
- `externalId` (string, nullable) — the official CVE ID or external vuln ID
- `severity` (enum: `NONE`, `INFO`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`, nullable)
- `createdAt`, `updatedAt` (DateTime, auto)
- `createdBy` → User (nullable FK)

**Relations:**
- One Vulnerability → many Intelligence Reports (1:N)
- One Vulnerability → many Campaigns (N:M via join)
- One Vulnerability → many Malware/Tools (N:M via join — what malware exploits it)
- One Vulnerability → many Indicators (1:N — indicators that exploit this CVE)
- One Vulnerability → many Cases (many-to-many)

---

### 6. Intelligence Report (laporan intel yang menghubungkan semua)
A single intelligence report — the central document that ties sources, threat actors, campaigns, malware, vulns, indicators, and cases together.

**Fields:**
- `id` (UUID, PK)
- `title` (string, required)
- `summary` (string, nullable) — short abstract
- `description` (string, nullable, long-form)
- `confidence` (enum: `NONE`, `LOW`, `MEDIUM`, `HIGH`, default `NONE`)
- `reportOn` (DateTime, nullable) — when the incident/report was observed
- `published` (DateTime, nullable) — publication date
- `publishedBy` (string, nullable) — publisher name
- `isExternal` (boolean, default false)
- `rawContent` (string, nullable) — original/raw content if ingested
- `importHash` (string, nullable, unique) — hash for deduplication (import)
- `createdAt`, `updatedAt` (DateTime, auto)
- `source` → Source (N:1, required FK — setiap report punya satu source)
- `createdBy` → User (nullable FK)

**Relations:**
- N:1 with Source (required)
- N:1 with Threat Actor (optional FK — primary actor)
- N:1 with Campaign (optional FK — primary campaign)
- N:1 with Malware/Tool (optional FK — primary malware)
- N:1 with Vulnerability (optional FK — primary CVE)
- One Report → many Indicators (1:N — the IOCs/contacts/observables)
- One Report → many Cases (many-to-many via `CaseReport`)

---

### 7. Indicator / Observable (IOC)
The actual IOCs: IPs, domains, file hashes, URLs, email addresses, registry keys, etc.

**Fields:**
- `id` (UUID, PK)
- `indicator` (string, required) — the raw observable value, e.g. "192.168.1.100", "evil.example.com"
- `type` (enum: `NONE`, `IMAGE`, `ACCOUNT`, `ACTOR`, `CAMPAIGN`, `CERTIFICATE`, `CVE`, `EXTERNAL_ID`, `HOST`, `IPV4`, `IPV6`, `JAVA_CLASS`, `MEMORY_POOL`, `NETFLOW`, `PAYLOAD`, `PHISHING_EMAIL`, `PROCESS`, `REGISTRY_KEY`, `REPORT`, `THREAT_ACTOR`, `TOOL`, `URL`, `USERNAME`, `WINDOWS_FILE`, `UNKNOWN`, default `NONE`)
- `description` (string, nullable)
- `confidence` (enum: `NONE`, `LOW`, `MEDIUM`, `HIGH`, default `NONE`)
- `validFrom` (DateTime, nullable)
- `validUntil` (DateTime, nullable)
- `isActive` (boolean, default true)
- `createdAt`, `updatedAt` (DateTime, auto)
- `createdBy` → User (nullable FK)

**Relations:**
- One Indicator → many Intelligence Reports (N:M via join table `ReportIndicator`)
- One Indicator → one Malware/Tool (optional N:1)
- One Indicator → one Vulnerability (optional N:1)
- One Indicator → many Campaigns (N:M via `CampaignIndicator`)
- One Indicator → many Cases (many-to-many)

---

### 8. Case (kasus investigasi)
A case — the live investigation object that groups reports, alerts, and indicators around a specific incident.

**Fields:**
- `id` (UUID, PK)
- `title` (string, required)
- `description` (string, nullable)
- `severity` (enum: `NONE`, `INFO`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`, default `NONE`)
- `status` (enum: `NOT_DEFINED`, `NEW`, `ON_HOLD`, `IN_PROGRESS`, `RESOLVED`, `FALSE_POSITIVE`, `REJECTED`, default `NOT_DEFINED`)
- `createdAt`, `updatedAt` (DateTime, auto)
- `createdBy` → User (nullable FK)

**Relations:**
- Many-to-many with Source (via `CaseSource`)
- Many-to-many with Threat Actor (via `CaseThreatActor`)
- Many-to-many with Campaign (via `CaseCampaign`)
- Many-to-many with Malware/Tool (via `CaseMalware`)
- Many-to-many with Vulnerability (via `CaseVulnerability`)
- Many-to-many with Intelligence Report (via `CaseReport`)
- Many-to-many with Indicator (via `CaseIndicator`)
- One Case → many Alerts (1:N, the alert is child of case)

---

### 9. Alert (peringatan/alert dari feed)
An alert generated from a feed or detection rule — lower-level than a report.

**Fields:**
- `id` (UUID, PK)
- `title` (string, required)
- `description` (string, nullable)
- `severity` (enum: `NONE`, `INFO`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`, default `NONE`)
- `confidence` (enum: `NONE`, `LOW`, `MEDIUM`, `HIGH`, default `NONE`)
- `source` → Source (N:1, required — alert berasal dari satu source)
- `indicator` → Indicator (optional N:1 FK)
- `isTriage` (boolean, default false) — already triaged?
- `createdAt`, `updatedAt` (DateTime, auto)
- `createdBy` → User (nullable FK)

**Relations:**
- N:1 with Source (required)
- N:1 with Indicator (optional)
- N:1 with Case (optional — alert yang sudah dikelompokkan ke case tertentu)

---

## RELATIONSHIPS SUMMARY (JOINS)

Explicitly create these join tables/models:

| Join Table | Columns |
|---|---|
| `CaseSource` | `caseId`, `sourceId` |
| `CaseThreatActor` | `caseId`, `threatActorId` |
| `CaseCampaign` | `caseId`, `campaignId` |
| `CaseMalware` | `caseId`, `malwareId` |
| `CaseVulnerability` | `caseId`, `vulnerabilityId` |
| `CaseReport` | `caseId`, `reportId` |
| `CaseIndicator` | `caseId`, `indicatorId` |
| `ThreatActorMalware` | `threatActorId`, `malwareId` |
| `CampaignMalware` | `campaignId`, `malwareId` |
| `CampaignIndicator` | `campaignId`, `indicatorId` |
| `ReportIndicator` | `reportId`, `indicatorId` |

---

## WHAT TO BUILD

### A. Prisma Schema
Add all 9 entities + 11 join tables to `backend/prisma/schema.prisma`. Follow existing conventions (look at the current schema first). Use UUIDs for IDs, DateTime with defaults, enums as Prisma enums, proper relations with `onDelete` where appropriate.

### B. Backend (NestJS)

For EACH entity, create a full CRUD module:

1. **DTOs** (`dto/*.dto.ts`): create DTO + update DTO with `class-validator` decorators (`@IsString()`, `@IsUUID()`, `@IsEnum()`, `@IsOptional()`, `@IsBoolean()`, `@IsArray()`, `@IsDateString()`, `@IsInt()`, `@Min()`, `@Max()`, `@Length()`, etc.)
2. **Entity service** (`*.service.ts`): CRUD methods (`create`, `findAll`, `findOne`, `update`, `remove`) + any entity-specific queries (e.g. for Report: `findBySource`, `findByThreatActor`; for Case: `findOpenCases`, `findBySeverity`)
3. **Entity controller** (`*.controller.ts`): REST endpoints, use `@ApiTags`, `@ApiOperation`, `@ApiResponse` from `@nestjs/swagger`
4. **Entity module** (`*.module.ts`): imports service, controller, Prisma module
5. **Relations endpoints**: Extra controller endpoints for managing relationships:
   - e.g. `POST /cases/:id/sources` — attach source to case
   - e.g. `DELETE /cases/:id/sources/:sourceId` — detach
   - Same pattern for all many-to-many relationships

Folder structure: follow existing pattern in `backend/src/` — look at how modules are organized there.

**Swagger**: Every endpoint must have `@ApiTags`, `@ApiOperation`, `@ApiResponse` decorators.

**Prisma service**: Use the existing `PrismaService` from the project (check `backend/src/prisma/`).

### C. Frontend (Next.js + shadcn/ui)

For EACH entity, create:

1. **List page** (`app/<entity-plural>/page.tsx`): table of all records with columns for key fields + action buttons (view, edit, delete). Use `@tanstack/react-table` if the project uses it, otherwise plain table.
2. **Detail page** (`app/<entity-plural>/[id]/page.tsx`): read-only view of one record with all fields + relations displayed (related cases, related reports, etc.)
3. **Create/Edit page** (`app/<entity-plural>/new/page.tsx` and `app/<entity-plural>/[id]/edit/page.tsx`): form with all fields, validation, client-side form handling with react-hook-form + zod (check if project uses these; if not, use plain state)
4. **API integration**: Use `fetch` or the project's existing HTTP client pattern (check `frontend/lib/` or existing API calls)

**UI components**: Use shadcn/ui components (Button, Input, Select, Textarea, Table, Card, Dialog, Badge, Tabs — check what's installed in `frontend/components/ui/`). Use Tailwind CSS (check `frontend/app/globals.css`).

**Layout/sidebar**: Update the sidebar in `frontend/components/dashboard/Sidebar.tsx` to add navigation links to the new CTI pages.

**API base URL**: Check how existing frontend calls the backend (env var? hardcoded?). Follow the same pattern.

### D. Seed Data

Create a seed script `backend/prisma/seed.ts` (or update existing one) with realistic sample data:
- 3-5 Sources (2 external feeds, 1 internal, 1 partner)
- 3-5 Threat Actors (e.g. APT29, Lazarus, FIN7, with aliases)
- 2-3 Campaigns linked to threat actors
- 3-5 Malware/Tools (e.g. Cobalt Strike, Mimikatz, a custom RAT)
- 3-5 CVEs (real or realistic CVE IDs)
- 5-10 Intelligence Reports linking sources + actors + campaigns + malware + vulns + indicators
- 15-20 Indicators of various types (IPv4, URL, domain, file hash, email)
- 2-3 Cases with mixed relationships
- 3-5 Alerts

Use proper UUIDs and link everything realistically.

### E. Database Migration

After updating the schema + seed, run:
```
cd backend && npx prisma migrate dev --name add_cti_core
cd backend && npx prisma db seed
```
Verify the migration created without errors and seed populated the DB.

---

## EXISTING PROJECT PATTERNS TO FOLLOW

Before writing any code, read these files to understand conventions:
- `backend/prisma/schema.prisma` — current schema, naming conventions, existing models
- `backend/src/app.module.ts` — how modules are registered
- `backend/src/auth/` — existing auth module (for `@CurrentUser()` pattern if any)
- `backend/src/indicators/` — existing indicators module (reference for structure)
- `frontend/app/layout.tsx` — root layout, auth provider, font setup
- `frontend/app/globals.css` — Tailwind + CSS variables
- `frontend/components/dashboard/Sidebar.tsx` — sidebar structure
- `frontend/components/dashboard/StatCard.tsx` — reusable card component
- `frontend/components.json` — shadcn component registry
- `frontend/lib/` — if exists, utility functions and API client
- `frontend/app/users/page.tsx` — if exists, reference for list page pattern
- `frontend/app/tenants/page.tsx` — if exists, reference for tenant-aware pages

Follow:
- Existing coding style (quotes, semicolons, imports order)
- Existing API response format (check one existing controller response)
- Existing error handling pattern
- Existing DTO patterns
- Existing Prisma model naming (PascalCase for models, camelCase for fields)

---

## RELATIONS UI REQUIREMENTS

For Case pages especially, the UI must allow attaching/detaching related entities:

- Case detail page must show tabs or sections for: Reports, Sources, Threat Actors, Campaigns, Malware, CVEs, Indicators, Alerts
- Each tab shows the related records in a table
- "Attach" button opens a multi-select dialog to pick entities to link
- "Detach" button removes the link (not delete the entity)

For Report pages, similar but with: Source (dropdown, required), Threat Actor (optional dropdown), Campaign (optional dropdown), Malware (optional dropdown), Vulnerability (optional dropdown), Indicators (multi-select).

---

## PRIORITY ORDER

1. Prisma schema + migration (all entities + joins — this is the foundation, everything else depends on it)
2. Backend DTOs + Services for all entities
3. Backend Controllers + Modules + Swagger decorators
4. Relation management endpoints
5. Seed data + seed run
6. Frontend: Sidebar navigation update
7. Frontend: List pages for all entities
8. Frontend: Detail pages for all entities
9. Frontend: Create/Edit pages for all entities
10. Frontend: Case management UI with attach/detach relations

---

## QUALITY BAR

- No placeholder code. Every endpoint must work.
- DTOs must validate properly with class-validator.
- Handle errors with proper HTTP status codes (400, 404, 409, 500).
- Unique constraints: `importHash` on Report must be unique; `name` on Source, ThreatActor, Campaign, Malware, Vulnerability, Case must be unique within their type.
- Soft-delete pattern: do NOT implement soft-delete — use hard delete with cascade where appropriate.
- All timestamps auto-managed by Prisma `@default(now())`.
- Frontend forms must handle loading, error, and success states.
- Frontend must handle the case where backend is not reachable (showing error message, not crash).

---

## COMMAND TO RUN AFTER

After everything is coded, run:
```bash
cd backend && npx prisma migrate dev --name add_cti_core
cd backend && npx prisma generate
cd backend && npx prisma db seed
cd backend && npm run start:dev &
sleep 5
curl -s http://localhost:3000/api | head  # health check
curl -s http://localhost:3000/api/sources | head  # test endpoint
curl -s http://localhost:3000/api/threat-actors | head  # test endpoint
```

Then verify the frontend builds:
```bash
cd frontend && npm run build
```

Fix any errors before declaring done.

---

## DELIVERABLE CHECKLIST

- [ ] Prisma schema updated with all 9 entities + 11 join tables
- [ ] Migration created and applied
- [ ] Backend: DTO, Service, Controller, Module for each of the 9 entities
- [ ] Backend: Relation management endpoints for all many-to-many relationships
- [ ] Backend: Swagger decorators on all endpoints
- [ ] Backend: Seed script with realistic data
- [ ] Backend: DB migrated + seeded successfully
- [ ] Frontend: Sidebar updated with new navigation items
- [ ] Frontend: List page for each entity (8 list pages)
- [ ] Frontend: Detail page for each entity (8 detail pages)
- [ ] Frontend: Create + Edit pages for each entity (16 pages)
- [ ] Frontend: Case detail with relation tabs and attach/detach UI
- [ ] Frontend: Report create/edit with relation dropdowns
- [ ] Frontend: `npm run build` passes with no errors
- [ ] `curl` tests confirm API responds correctly for sources, threat actors, campaigns, malware, vulns, reports, indicators, cases, alerts

---

Begin by reading all the reference files listed above, then implement in priority order. Do not skip any entity. Do not write pseudocode — produce real, runnable code.
