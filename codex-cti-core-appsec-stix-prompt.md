# INSTRUCTION: Build CTI Core + STIX/TAXII Integration + AppSec Domain for CTI App

You are working on a Cyber Threat Intelligence (CTI) web application with:
- **Backend**: NestJS + Prisma (PostgreSQL), located in `backend/`
- **Frontend**: Next.js + Tailwind CSS + shadcn/ui, located in `frontend/`
- **Repo**: https://github.com/jafhdr/cti-app
- **Existing schema**: `backend/prisma/schema.prisma` — check it first for existing models and naming conventions

## Your Mission
Build the full CTI Core foundation **plus** STIX 2.1/TAXII integration layer **plus** an AppSec domain, all wired together. Nothing else matters until this is done.

The work is organized as **three layers** that must all be completed:

1. **CTI Core** — internal entities and relations (Source/Feed, Threat Actor, Campaign, Malware/Tool, Vulnerability/CVE, Intelligence Report, Indicator, Case, Alert)
2. **STIX 2.1 & TAXII** — external format adapters only. These are **NOT** the internal data model; they are ingest/export/poll bridges that translate STIX bundles and TAXII collections into/from internal entities.
3. **AppSec Domain** — application/repository assets, scan findings, severity, SLA remediation, evidence, CI/CD integration
4. **Cross-Domain Linkage** — CTI and AppSec enrich each other. CVEs/findings in AppSec can be linked to IOC, campaign, actor, and threat intelligence. CTI can inform AppSec prioritization.

---

## HARD CONSTRAINTS (JANGAN LANGKAHI)

**Ports and URLs that already exist — use them, never change them:**

| Layanan | Port | Cara akses |
|---|---|---|
| Frontend (Next.js) | `3000` | `http://localhost:3000` |
| Backend (NestJS) | `3001` | `http://localhost:3001` |
| Swagger docs | `3001/docs` | `http://localhost:3001/docs` |

**Backend port** — `backend/src/main.ts` listens on `process.env.PORT || 3001`. Jangan ubah. Jangan tambah server lain (Express/Fastify standalone, multiple Concurrently servers). Cukup satu NestJS App di port 3001.

**Frontend API calls** — ikuti pola yang sudah ada di project (cek `frontend/lib/` atau pola fetch di halaman yang sudah ada). Jangan buat file konfigurasi API baru. Jangan hardcode `http://localhost:3001` di dalam component; pakai pola yang konsisten dengan halaman lain atau variabel env yang sudah ada.

**Environment variables** — jangan tambah `.env` file baru atau variabel baru yang tidak disebutkan di prompt ini. Kalau perlu env var baru, pakai yang sudah ada di `backend/.env` dan `frontend/.env.local` (jika ada).

**JANGAN buat:**
- File `config/` baru di backend atau frontend
- Dockerfile / docker-compose baru — ini lokal untuk sekarang
- Proxy API di `next.config.js` rewrites — frontend harus call backend langsung ke `http://localhost:3001`
- STIX/TAXII internal schema — internal Prisma models tetap native, STIX adalah format integrasi saja

**STIX 2.1 & TAXII adalah format integrasi, BUKAN model internal yang dipaksakan.** Artinya:
- Internal DB tetap pakai model Prisma yang already-defined di prompt ini.
- STIX/TAXII hanyalah layer adapter: `ingest` (menerima bundle, memetakan ke internal entities), `export` (mengeluarkan internal entities sebagai STIX bundle), dan `taxii-collect` / webhook receiver (polling atau push dari TAXII server).
- Parser STIX harus robust: mapping STIX objects (`indicator`, `threat-actor`, `campaign`, `malware`, `vulnerability`, `observation`, `marking-definition`, `identity`, `incident`) ke internal entities, dengan fallback/toleransi jika ada field yang tidak dipetakan. Jangan reject bundle karena satu field belum Support.
- Jangan buat Prisma model baru yang mencontoh STIX schema secara langsung. Internal schema tetap seperti di bawah.

---

## LAYER 1 — CTI CORE (internal entities + relations)

### 1. Source / Feed
| Field | Tipe | Keterangan |
|---|---|---|
| id | UUID PK | |
| name | string required | e.g. "AlienVault OTX", "Internal Dark Web Monitor", "Partner ISAC Feed" |
| type | enum: FEED, SOURCES, INTERNAL, PARTNER | |
| description | string nullable | |
| url | string nullable | |
| isExternal | boolean default false | |
| isActive | boolean default true | |
| createdAt, updatedAt | DateTime auto | |

Relations: 1:N ke Intelligence Report. Many-to-many ke Case (`CaseSource`).

### 2. Threat Actor
| Field | Tipe |
|---|---|
| id | UUID PK |
| name | string required |
| aliases | string[] nullable |
| description | string nullable |
| sophistication | enum NONE/LOW/MEDIUM/HIGH/SUCCESSFUL nullable |
| operationalPrivacy | enum PUBLIC/PRIVATE/RESTRICTED nullable |
| primaryMotivation | enum NONE/CRIMINAL/EW/ESPIONAGE/HACKTIVISM/SABOTAGE/UNKNOWN nullable |
| isAnonymous | boolean default false |
| isObserved | boolean default false |
| createdAt, updatedAt | DateTime auto |

Relations: 1:N ke Report, 1:N ke Campaign, 1:N ke Indicator (via join), N:M ke Malware (`ThreatActorMalware`), N:M ke Case (`CaseThreatActor`), N:M ke Target (`ThreatActorTarget`).

### 3. Campaign
| Field | Tipe |
|---|---|
| id | UUID PK |
| name | string required |
| description | string nullable |
| status | enum NOT_DEFINED/NEW/ON_GOING/COMPLETED/ABANDONED default NOT_DEFINED |
| firstSeen, lastSeen | DateTime nullable |
| createdAt, updatedAt | DateTime auto |

Relations: N:1 Threat Actor, 1:N Report, N:M Malware (`CampaignMalware`), N:M Indicator (`CampaignIndicator`), many-to-many Case (`CaseCampaign`).

### 4. Malware / Tool
| Field | Tipe |
|---|---|
| id | UUID PK |
| name | string required |
| type | enum NONE/ABUSE_MATERIAL/ACTIVITY/BACKDOOR/CONTROL_SERVER/DATA_DESTROYER/DATA_EXFILTRATOR/DATA_ENCRYPTOR/DATA_TROVE/DDOS/REMOTE_ACCESS/VULNERABILITY/WEAPON/UNKNOWN default NONE |
| description | string nullable |
| isSigned | boolean default false |
| isCommercial | boolean default false |
| isOpenSource | boolean default false |
| createdAt, updatedAt | DateTime auto |

Relations: 1:N Report, N:M Threat Actor, N:M Campaign, 1:N Indicator (via join), many-to-many Case (`CaseMalware`).

### 5. Vulnerability / CVE
| Field | Tipe |
|---|---|
| id | UUID PK |
| name | string required (e.g. "CVE-2024-1234") |
| description | string nullable |
| externalId | string nullable (official CVE ID) |
| severity | enum NONE/INFO/LOW/MEDIUM/HIGH/CRITICAL nullable |
| createdAt, updatedAt | DateTime auto |

Relations: 1:N Report, N:M Campaign, N:M Malware, 1:N Indicator, many-to-many Case (`CaseVulnerability`).

### 6. Intelligence Report
| Field | Tipe |
|---|---|
| id | UUID PK |
| title | string required |
| summary | string nullable |
| description | string nullable |
| confidence | enum NONE/LOW/MEDIUM/HIGH default NONE |
| reportOn | DateTime nullable |
| published | DateTime nullable |
| publishedBy | string nullable |
| isExternal | boolean default false |
| rawContent | string nullable |
| importHash | string nullable, unique (dedup key) |
| createdAt, updatedAt | DateTime auto |

Relations: **N:1 Source (required)**, N:1 Threat Actor (optional), N:1 Campaign (optional), N:1 Malware (optional), N:1 Vulnerability (optional), 1:N Indicator (`ReportIndicator`), many-to-many Case (`CaseReport`).

### 7. Indicator / Observable
| Field | Tipe |
|---|---|
| id | UUID PK |
| indicator | string required (e.g. "192.168.1.100", "evil.example.com") |
| type | enum NONE/IMAGE/ACCOUNT/ACTOR/CAMPAIGN/CERTIFICATE/CVE/EXTERNAL_ID/HOST/IPV4/IPV6/JAVA_CLASS/MEMORY_POOL/NETFLOW/PAYLOAD/PHISHING_EMAIL/PROCESS/REGISTRY_KEY/REPORT/THREAT_ACTOR/TOOL/URL/USERNAME/WINDOWS_FILE/UNKNOWN default NONE |
| description | string nullable |
| confidence | enum NONE/LOW/MEDIUM/HIGH default NONE |
| validFrom, validUntil | DateTime nullable |
| isActive | boolean default true |
| createdAt, updatedAt | DateTime auto |

Relations: N:M Report (`ReportIndicator`), optional N:1 Malware, optional N:1 Vulnerability, N:M Campaign (`CampaignIndicator`), many-to-many Case (`CaseIndicator`).

### 8. Case
| Field | Tipe |
|---|---|
| id | UUID PK |
| title | string required |
| description | string nullable |
| severity | enum NONE/INFO/LOW/MEDIUM/HIGH/CRITICAL default NONE |
| status | enum NOT_DEFINED/NEW/ON_HOLD/IN_PROGRESS/RESOLVED/FALSE_POSITIVE/REJECTED default NOT_DEFINED |
| createdAt, updatedAt | DateTime auto |

Relations: many-to-many Source, Threat Actor, Campaign, Malware, Vulnerability, Report, Indicator. 1:N Alert.

### 9. Alert
| Field | Tipe |
|---|---|
| id | UUID PK |
| title | string required |
| description | string nullable |
| severity | enum NONE/INFO/LOW/MEDIUM/HIGH/CRITICAL default NONE |
| confidence | enum NONE/LOW/MEDIUM/HIGH default NONE |
| isTriage | boolean default false |
| createdAt, updatedAt | DateTime auto |

Relations: **N:1 Source (required)**, optional N:1 Indicator, optional N:1 Case.

### Join Tables (explicit models)
- `CaseSource` (caseId, sourceId)
- `CaseThreatActor` (caseId, threatActorId)
- `CaseCampaign` (caseId, campaignId)
- `CaseMalware` (caseId, malwareId)
- `CaseVulnerability` (caseId, vulnerabilityId)
- `CaseReport` (caseId, reportId)
- `CaseIndicator` (caseId, indicatorId)
- `ThreatActorMalware` (threatActorId, malwareId)
- `CampaignMalware` (campaignId, malwareId)
- `CampaignIndicator` (campaignId, indicatorId)
- `ReportIndicator` (reportId, indicatorId)

---

## LAYER 2 — STIX 2.1 & TAXII INTEGRATION (format adapters only)

Implement an **adapter layer** at `backend/src/stix/` and `backend/src/taxii/`. This layer does **not** replace the internal Prisma schema. It translates STIX bundles and TAXII collections to/from internal entities.

### STIX 2.1 Ingest
- Endpoint: `POST /api/stix/ingest`
- Request: STIX 2.1 bundle (JSON). Opsi body atau multipart (kalau file besar).
- Behavior:
  - Parse bundle, iterasi objects.
  - Map STIX object types ke internal entities: `indicator`→Indicator, `threat-actor`→ThreatActor, `campaign`→Campaign, `malware`→Malware, `vulnerability`→Vulnerability, `identity`→Source (atau Internal), `incident`→Case (opsional), `observation`→Indicator (jika ada observable).
  - Linking: STIX `created_by_ref` → Source, `first_seen`/`last_seen`→Campaign, `external_references`→Vulnerability/CVE, `labels`→type/confidence mapping.
  - Dedup: gunakan `importHash` (SHA-256 dari STIX id + bundle context) untuk menghindari duplikasi.
  - Return summary: `{ ingested: { indicators, actors, campaigns, malware, vulns, sources, cases }, skipped: { reason, count }, errors: [] }`
- Error handling: jika satu object gagal dimap, lanjut ke object berikutnya. Laporkan error per-object, jangan abort seluruh bundle.
- Swagger: `@ApiTags('stix')`, `@ApiOperation('Ingest STIX 2.1 bundle')`, `@ApiResponse` 200/400/413/500.

### STIX 2.1 Export
- Endpoint: `GET /api/stix/export?scope=...` (scope: all, atau filter entity type + IDs)
- Behavior:
  - Query internal entities sesuai scope.
  - Map ke STIX 2.1 objects: Indicator→indicator, ThreatActor→threat-actor, Campaign→campaign, Malware→malware, Vulnerability→vulnerability (custom object atau external_reference), Source→identity, Case→incident (opsional).
  - Emit STIX 2.1 bundle JSON dengan proper `id`, `created`, `modified`, `spec_version: 2.1`, relationships di mana relevan.
  - Return `{ bundle: {...}, exported: { count per type } }`
- Swagger: `@ApiTags('stix')`, `@ApiOperation('Export internal entities as STIX 2.1 bundle')`.

### TAXII 2.1 Collect (poll)
- Endpoint: `POST /api/taxii/collect`
- Behavior:
  - Konfigurasi TAXII server dari env/config (URL, username, password/token, collection paths). Kalau tidak dikonfigurasi, return `{ skipped: 'TAXII not configured' }` tanpa error.
  - Poll collection(s), dapatkan STIX bundles, lalu passing ke STIX ingest pipeline yang sama.
  - Rate-limit-friendly: hitung timestamp terakhir poll, tidak polling berlebihan.
  - Return summary mirip ingest.

### TAXII Push / Webhook Receiver
- Endpoint: `POST /api/taxii/receive` (untuk menerima push dari TAXII server jika diwebhookkan)
- Behavior: sama seperti ingest, tapi lebih sederhana. Opsional: simpan metadata dari TAXII server (collection name, timestamp).
- Swagger: `@ApiTags('taxii')`.

### Mapper module (`backend/src/stix/mapper/`)
- Pisahkan logika mapping dari controller. Satu file `stix-mapper.ts` (atau modul kecil) yang memetak STIX object → internal DTOs/entities dan sebaliknya.
- Sertakan fallback: kalau field STIX tidak dikenal, simpan sebagai `rawContent` atau skip dengan log, jangan crash.
- Unit testable konseptual: fungsi mapper murni, tanpa Prisma langsung (ambil DTOs, service yang menulis ke DB).

### Rules
- STIX/TAXII tidak membuat Prisma model baru yang menyamai STIX schema.
- STIX/TAXII tidak memaksa field internal yang tidak ada.
- STIX/TAXII adalah integrasi — internal aplikasi tetap pakai model di Layer 1.

---

## LAYER 3 — APPSec DOMAIN (domain terpisah, terhubung ke CTI)

### 1. Asset (application / repository / cloud resource)
| Field | Tipe |
|---|---|
| id | UUID PK |
| name | string required |
| type | enum APPLICATION, REPOSITORY, CLOUD_RESOURCE, INFRASTRUCTURE, THIRD_PARTY default APPLICATION |
| description | string nullable |
| criticality | enum LOW/MEDIUM/HIGH/CRITICAL default MEDIUM |
| owner | string nullable (team/person) |
| repoUrl | string nullable |
| branch | string nullable |
| status | enum ACTIVE/DEPRECATED/ARCHIVED default ACTIVE |
| lastScan | DateTime nullable |
| createdAt, updatedAt | DateTime auto |

Relations: 1:N AppSecFinding. Optional many-to-many dengan Threat Actor, Campaign, Malware, Indicator (untuk enrichment).

### 2. AppSecFinding (scan result)
| Field | Tipe |
|---|---|
| id | UUID PK |
| title | string required |
| description | string nullable |
| severity | enum NONE/INFO/LOW/MEDIUM/HIGH/CRITICAL default NONE |
| confidence | enum NONE/LOW/MEDIUM/HIGH default NONE |
| status | enum OPEN/MITIGATED/FALSE_POSITIVE/CLOSED default OPEN |
| cveId | string nullable (langsung string CVE ID, juga boleh link ke Vulnerability entity) |
| cvssScore | float nullable |
| component | string nullable (nama dependensi/component yang bermasalah) |
| filePath | string nullable |
| line | int nullable |
| remediationSla | DateTime nullable (deadline perbaikan) |
| slaBreached | boolean default false (computed: jika remediationSla < now dan status OPEN) |
| createdAt, updatedAt | DateTime auto |

Relations: **N:1 Asset (required)**. Optional N:1 Vulnerability (jika CVE dimatch ke internal entity). 1:N Evidence. Optional N:1 CICDRun. N:M dengan Threat Actor, Campaign, Malware, Indicator (enrichment).

### 3. Evidence
| Field | Tipe |
|---|---|
| id | UUID PK |
| findingId | relation ke AppSecFinding |
| type | enum CODE_SNIPPET, SCREENSHOT, LOG, PIPELINE_URL, ATTACHMENT, NOTES default NOTES |
| title | string nullable |
| data | string (teks/long text — bisa JSON, snippet, URL, dll) |
| createdAt, updatedAt | DateTime auto |

### 4. CICDRun (CI/CD integration record)
| Field | Tipe |
|---|---|
| id | UUID PK |
| pipelineName | string required (mis. "github-actions/security-scan") |
| pipelineRunId | string nullable (ID dari runner eksternal) |
| tool | enum SEMGREP, CODEQL, SONARQUBE, SNYK, DEPENDABOT, TRIVY, GRYPE, ZAP, CUSTOM, UNKNOWN default CUSTOM |
| triggeredBy | string nullable (commit SHA, PR number, schedule, manual) |
| status | enum RUNNING/SUCCEEDED/FAILED/CANCELLED default SUCCEEDED |
| startedAt, finishedAt | DateTime nullable |
| payload | string nullable (raw webhook/payload summary, JSON string) |
| createdAt, updatedAt | DateTime auto |

Relations: 1:N AppSecFinding (findings dari run ini). Optional N:1 Asset.

---

## LAYER 4 — CROSS-DOMAIN LINKAGE (CTI ↔ AppSec)

Hubungkan keduanya secara eksplisit di schema, backend, frontend, dan seed.

### Schema links
- `AppSecFinding` → N:M dengan `ThreatActor`, `Campaign`, `Malware`, `Indicator` (join table: `FindingThreatActor`, `FindingCampaign`, `FindingMalware`, `FindingIndicator`)
- `AppSecFinding` → optional N:1 `Vulnerability` (jika CVE dimatch ke internal Vulnerability entity)
- `Asset` → N:M dengan `ThreatActor`, `Campaign`, `Indicator` (join table: `AssetThreatActor`, `AssetCampaign`, `AssetIndicator`)
- `Vulnerability` → bisa link ke `AppSecFinding` dari sisi CTI (optional, jika AppSec finding merujuk CVE internal)

### Enrichment logic (backend service)
- `AppSecFindingService.enrich(findingId)` — lookup external CTI: cari Threat Actor, Campaign, Malware, Indicator yang relevan (oleh CVE ID, IOC, atau tag), lalu attach ke finding. Return enriched context.
- `Case` dan `Report` juga bisa enrich AppSec findings: jika sebuah case atau report mengandung CVE/IOC yang cocok, munculkan sebagai konteks.
- Enrichment bersifat **add-only** (attach), bukan overwrite. Tampilkan provenance: "enriched from CTI: source X, report Y, campaign Z".

### UI cross-link
- Di halaman detail Asset, tab "Findings" dan tab "Threat Intel" (actors/campaigns/indicators yang terlink).
- Di halaman detail Finding, section "CTI Enrichment": menunjukkan actor/campaign/malware/IOC yang terhubung, beserta sumber enrichment.
- Di halaman detail Case/Report, section "AppSec Findings" yang relevan (CVE/IOC overlap).
- Attach/detach enrichment: user bisa manual attach Threat Actor/Campaign/etc ke Finding atau Asset via multi-select dialog (mirip relation management di CTI core).

---

## PRIORITY ORDER (implementasi berurutan)

1. **Prisma schema** — semua entities Layer 1 (CTI Core) + Layer 3 (AppSec) + join tables Layer 4. Migrasi `add_cti_core_appsec`.
2. **Backend DTOs + Services** untuk CTI Core (Source, ThreatActor, Campaign, Malware, Vulnerability, Report, Indicator, Case, Alert).
3. **Backend Controllers + Modules + Swagger** untuk CTI Core.
4. **Relation management endpoints** untuk semua many-to-many CTI.
5. **Backend STIX/TAXII adapter layer** (ingest, export, taxii collect, taxii receive) + mapper module. Swagger.
6. **Backend DTOs + Services + Controllers + Modules** untuk AppSec (Asset, AppSecFinding, Evidence, CICDRun).
7. **Backend relation endpoints** untuk AppSec (attach/detach actor/campaign/malware/indicator ke finding & asset).
8. **Backend enrichment endpoints** (enrich finding, enrich asset, lihat konteks CTI).
9. **Seed data** — realistic cross-domain: CTI entities + AppSec assets + findings + evidence + CICDRun + STIX bundle sample (untuk testing ingest).
10. **Prisma migrate + generate + db seed** — verify tanpa error.
11. **Frontend: Sidebar** update dengan nav items CTI Core + STIX/TAXII + AppSec.
12. **Frontend: CTI Core pages** (list, detail, create/edit) untuk 9 entity.
13. **Frontend: STIX/TAXII pages** — ingest form (paste bundle / upload file), ingest history/log, export page (pilih scope, download bundle), taxii collect trigger + log.
14. **Frontend: AppSec pages** — Asset list/detail/create/edit, Finding list/detail/create/edit (dengan asset dropdown, cveId, remediation SLA, attach enrichment), Evidence list, CICDRun list.
15. **Frontend: relation UI** — attach/detach enrichment di Asset & Finding, relation tabs di Case/Report.
16. **Frontend: build** — `cd frontend && npm run build` tanpa error.
17. **Test** — start backend, curl endpoint kunci, verifikasi STIX ingest/export, verifikasi enrichment.

---

## WHAT TO BUILD — BACKEND (NestJS)

Untuk **setiap entity** di CTI Core dan AppSec, buat:
1. **DTOs** (`dto/*.dto.ts`): create DTO + update DTO dengan `class-validator` (`@IsString()`, `@IsUUID()`, `@IsEnum()`, `@IsOptional()`, `@IsBoolean()`, `@IsArray()`, `@IsDateString()`, `@IsInt()`, `@Min()`, `@Max()`, `@Length()`, `@IsFloat()`, dll).
2. **Service** (`*.service.ts`): CRUD (`create`, `findAll`, `findOne`, `update`, `remove`) + query spesifik (mis. `findOpenAppSecFindings`, `findBreachedSLA`, `enrich`, `findByAsset`, dll).
3. **Controller** (`*.controller.ts`): REST endpoints, `@ApiTags`, `@ApiOperation`, `@ApiResponse` dari `@nestjs/swagger`.
4. **Module** (`*.module.ts`): imports service + controller + Prisma module.
5. **Relation endpoints**: POST/DELETE untuk attach/detach many-to-many (contoh: `POST /findings/:id/actors`, `DELETE /findings/:id/actors/:actorId`).

**STIX/TAXII endpoints**: controller terpisah di `backend/src/stix/` dan `backend/src/taxii/`. Service mapper di `backend/src/stix/mapper/`. Tidak ada Prisma model STIX.

**PrismaService**: pakai yang sudah ada di project (cek `backend/src/prisma/`).

**Swagger**: semua endpoint wajib ada `@ApiTags`, `@ApiOperation`, `@ApiResponse`.

---

## WHAT TO BUILD — FRONTEND (Next.js + shadcn/ui)

Untuk **setiap entity**:
1. **List page** (`app/<entity-plural>/page.tsx`): tabel dengan kolom field kunci + action buttons (view, edit, delete). Ikuti pola yang ada di project (cek halaman existing).
2. **Detail page** (`app/<entity-plural>/[id]/page.tsx`): view satu record + relasi (lengkapi tab/section).
3. **Create/Edit page** (`app/<entity-plural>/new/page.tsx`, `app/<entity-plural>/[id]/edit/page.tsx`): form semua field, validasi, loading/error/success state. Ikuti pola project (react-hook-form + zod kalau project pakai; kalau tidak, plain state).
4. **API integration**: ikuti pola fetch/HTTP client yang ada di `frontend/lib/` atau halaman yang sudah ada.

**UI components**: shadcn/ui (Button, Input, Select, Textarea, Table, Card, Dialog, Badge, Tabs — cek `frontend/components/ui/`). Tailwind CSS (`frontend/app/globals.css`).

**Sidebar**: update `frontend/components/dashboard/Sidebar.tsx` tambah section:
- CTI Core (Sources, Threat Actors, Campaigns, Malware/Tools, CVEs/Vulnerabilities, Intelligence Reports, Indicators, Cases, Alerts)
- Integrasi (STIX Ingest/Export, TAXII Collect)
- AppSec (Assets, Findings, Evidence, CI/CD Runs)

**STIX pages**:
- Ingest: form textarea/file upload, tombol "Ingest", tampilkan log/summary hasil.
- History: list ingest/export/log terakhir.
- Export: pilih entity type + ID, tombol "Export STIX Bundle", download JSON.

**AppSec pages**:
- Asset: list/detail/create/edit, tab Findings, tab Threat Intel (actor/campaign/indicator yang terlink).
- Finding: list/detail/create/edit dengan asset dropdown (required), cveId, cvssScore, remediationSla, status, severity; section "CTI Enrichment" dengan attach/detach actor/campaign/malware/indicator + tombol "Enrich".
- Evidence: list per finding.
- CICDRun: list dengan pipelineName, tool, status, findings count.

**Relation UI**: attach/detach via multi-select dialog (shadcn Dialog + Select). Jangan delete entity yang diattach — hanya hapus link.

---

## SEED DATA (realistic cross-domain)

Update `backend/prisma/seed.ts` dengan data yang saling terhubung:

- 3-5 Sources (2 external feeds, 1 internal, 1 partner)
- 3-5 Threat Actors (APT29, Lazarus, FIN7, dengan aliases)
- 2-3 Campaigns terlink ke actor
- 3-5 Malware/Tools (Cobalt Strike, Mimikatz, custom RAT)
- 3-5 CVEs (real atau realistic CVE ID)
- 5-10 Intelligence Reports yang menghubungkan source + actor + campaign + malware + vuln + indicator
- 15-20 Indicators (IPv4, URL, domain, file hash, email)
- 2-3 Cases dengan mixed relations
- 3-5 Alerts
- **AppSec**: 3-5 Assets (aplikasi, repo, cloud resource), masing-masing punya 2-5 Findings dengan severity beragam, beberapa findings link ke CVE internal, beberapa findings punya Evidence, beberapa findings link ke Threat Actor/Campaign (enrichment).
- **CICDRun**: 2-3 run (Semgrep, Snyk, CodeQL), masing-masing punya beberapa findings.
- **STIX bundle sample** — satu STIX 2.1 bundle kecil (2-3 indicator, 1 threat-actor, 1 campaign, 1 malware) untuk testing ingest.

---

## QUALITY BAR

- No placeholder code. Setiap endpoint harus jalan.
- DTOs validasi dengan class-validator.
- HTTP status codes benar (400, 404, 409, 500).
- Unique constraints: `importHash` di Report, `name` di Source/ThreatActor/Campaign/Malware/Vulnerability/Case.
- Hard delete dengan cascade untuk join tables; entity utama juga hard delete (tidak soft-delete).
- Timestamps auto dari Prisma `@default(now())`.
- Frontend handle loading, error, success state.
- Frontend tidak crash jika backend tidak reachable; tampilkan error message.
- STIX/TAXII hanya adapter — tidak merubah internal Prisma schema.
- Enrichment add-only, tampilkan provenance sumber.
- Port tetap 3000 (FE) dan 3001 (BE); jangan ubah `main.ts`.

---

## DELIVERABLE CHECKLIST

- [ ] Prisma schema: CTI Core (9 entity + 11 join) + AppSec (Asset, Finding, Evidence, CICDRun + join enrichment) + cross-domain joins
- [ ] Migration `add_cti_core_appsec` sukses
- [ ] Backend DTOs, Services, Controllers, Modules untuk semua CTI entity
- [ ] Backend relation management endpoints untuk semua many-to-many CTI
- [ ] Backend STIX/TAXII: ingest, export, taxii collect, taxii receive + mapper + Swagger
- [ ] Backend AppSec: DTO, Service, Controller, Module untuk Asset, Finding, Evidence, CICDRun
- [ ] Backend enrichment endpoints (finding, asset) dengan provenance
- [ ] Backend seed: realistic cross-domain + STIX bundle sample
- [ ] DB migrate + generate + seed sukses
- [ ] Frontend sidebar: CTI Core, Integrasi (STIX/TAXII), AppSec
- [ ] Frontend CTI list/detail/create/edit halaman untuk 9 entity
- [ ] Frontend STIX: ingest form + history, export scope + download, taxii collect trigger + log
- [ ] Frontend AppSec: Asset, Finding, Evidence, CICDRun pages
- [ ] Frontend relation UI: attach/detach enrichment di Asset & Finding, relation tabs di Case/Report
- [ ] Frontend `npm run build` tanpa error
- [ ] Curl test: sources, threat-actors, campaigns, malware, vulns, reports, indicators, cases, alerts, STIX ingest/export, appsec assets/findings/enrichment

---

## REFERENCE FILES TO READ FIRST (wajib baca sebelum nulis kode)

- `backend/prisma/schema.prisma` — konvensi penamaan, model existing
- `backend/src/app.module.ts` — cara register module
- `backend/src/auth/` — pattern auth, `@CurrentUser()` kalau ada
- `backend/src/indicators/` — referensi struktur module existing
- `backend/src/prisma/` — PrismaService existing
- `backend/src/main.ts` — port, CORS origin, Swagger setup (JANGAN UBAH port)
- `frontend/app/layout.tsx` — root layout, auth provider, font
- `frontend/app/globals.css` — Tailwind + CSS variables
- `frontend/components/dashboard/Sidebar.tsx` — struktur sidebar
- `frontend/components/dashboard/StatCard.tsx` — reusable card
- `frontend/components.json` — shadcn registry
- `frontend/lib/` — kalau ada, util + API client
- `frontend/app/users/page.tsx` / `frontend/app/tenants/page.tsx` / `frontend/app/indicators/page.tsx` — referensi list page pattern yang sudah ada
- `frontend/components/ui/` — komponen shadcn yang terinstall

Ikuti: gaya koding existing (quotes, semicolon, import order), format response API yang sudah ada, pola error handling, pola DTO, konvensi model Prisma (PascalCase model, camelCase field).

---

Begin by reading all the reference files listed above, then implement in priority order. Do not skip any entity. Do not write pseudocode — produce real, runnable code.
