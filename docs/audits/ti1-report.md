# Threat Intelligence v1 Closure Phase 2 — Closure Implementation

Tanggal: 6 Oktober 2026 (Asia/Jakarta). Repository dan database lokal digunakan untuk verifikasi. Tidak ada commit, perubahan ASM, export, atau implementasi AppSec.

## 1. Verdict

**TI V1 CLOSED WITH LIMITATIONS.** Semua blocker internal dari `ti-audit-report.md` telah ditutup. Integrasi provider eksternal live belum diuji; ini batasan production readiness, bukan kegagalan kontrak internal TI v1.

## 2. 403 Root Cause

| Test/Endpoint Group | Expected Access | Actual Cause | Production Bug? | Fix |
|---|---|---|---|---|
| `indicators.correlation.integration.spec.cjs` (5) | ADMIN dengan `indicator-management` | A. TEST FIXTURE STALE: assignment modul ada, `featureKeys` kosong | Tidak | Fixture diberi `indicator-management` |
| `threat-actor-candidate-discovery.integration.spec.cjs` (8) | ADMIN dengan `indicator-management` | A. TEST FIXTURE STALE | Tidak | Fixture diberi `indicator-management` |
| `mitre-threat-actor-ingestion.integration.spec.cjs` (5) | ADMIN/USER sesuai route dengan `intelligence-hub` | A. TEST FIXTURE STALE | Tidak | Kedua fixture diberi `intelligence-hub` |
| `threat-actors.ingestion.integration.spec.cjs` (12) | ADMIN dengan `intelligence-hub` | A. TEST FIXTURE STALE | Tidak | Fixture diberi `intelligence-hub` |

Guard memeriksa `module.accessible` dan `effectiveFeatures` dari assignment user, role, tenant module setting, dan subscription. Fixture lama memenuhi subscription, module enablement, role access, dan assignment, tetapi membuat `UserModuleAccess.featureKeys=[]`. Karena controller benar-benar meminta feature lewat `RequiresModuleFeature`, respons 403 memang sesuai kebijakan. Setelah hanya fixture diubah, 32/32 tes dalam empat file lulus; tidak ada perubahan production authorization. Fixture Playwright lama pada beberapa halaman juga memiliki feature kosong. Fixture itu diperbarui hanya pada skenario yang mengharapkan akses; skenario deny tetap menguji penolakan.

## 3. Provenance Result

Model `IndicatorSourceObservation` menyimpan `tenantId`, `indicatorId`, ID sumber bila masih ada, `sourceKey` yang stabil, nama sumber/provider sebagai snapshot, `origin`, `firstSeenAt`, dan `lastSeenAt`. Kunci unik `(tenantId, indicatorId, sourceKey)` menjaga satu observasi per sumber dan Indicator. Feed upsert menulis Indicator dan observasinya dalam satu transaksi. Upsert dari sumber baru tidak lagi menimpa field `source` dan `intelligenceSourceId` pada Indicator yang sudah ada.

Tes database baru membuktikan Feed A → IOC X dan Feed B → IOC X menghasilkan **1 Indicator, 2 observasi**. Sync ulang Feed A tetap menghasilkan 2 observasi, mempertahankan `firstSeenAt`, dan memperbarui `lastSeenAt`. Penghapusan sumber tidak menghilangkan snapshot identitas feed. Case mengembalikan Indicator beserta `sourceObservations`; tampilan Case dan detail Indicator menampilkan kedua sumber, provider, serta waktu first/last seen.

Migration membackfill **sumber terakhir yang masih tersimpan** pada Indicator lama, termasuk timestamp lama. Asal feed yang sudah tertimpa sebelum migration tidak dapat direkonstruksi dari schema lama; ini batas historis data, bukan kehilangan data oleh migration.

## 4. Enrichment Result

| Asal Indicator | Policy |
|---|---|
| Automated feed | Auto-enqueue job VirusTotal saat API key dikonfigurasi. Tipe normalisasi provider saat ini (`URL`, `FILE_HASH`, `IP_ADDRESS`) didukung oleh client VirusTotal. Unique job `(tenantId, indicatorId, provider)` mencegah duplikasi. Worker existing menangani cooldown, retry/backoff, max attempts, dan tenant. |
| Telegram-approved candidate | Tetap auto-enqueue sesuai alur existing; approval analis tetap wajib. |
| Manual creation | Tetap enrichment manual; tidak ditambahkan auto-enqueue. |

Kegagalan membuat job dicatat sebagai error per Indicator dan tidak menggagalkan feed sync atau menghapus Indicator/provenance yang sudah committed. Tes baru membuktikan jalur ini dan jalur tanpa API key. Tidak ada provider call sinkron di ingestion request.

## 5. Workflow Status

| Workflow | Result | Automation | Analyst Action | Verified |
|---|---|---|---|---|
| Feed → Indicator → source observation | DONE | Feed scheduler/manual sync | Tidak untuk scheduled sync | Tes DB baru + 340 `.cjs` |
| Feed Indicator → enrichment job | DONE saat eligible/configured | Otomatis | Tidak | Tes DB baru, worker tests existing |
| Telegram → Candidate → Indicator → enrichment | DONE | Poll/extract/job | Approve/reject | `.cjs` Telegram |
| Threat Actor/MITRE | DONE | MITRE scheduler | Attribution confirmation | 32/32 tes endpoint sebelumnya gagal 403 kini lulus |
| Indicator → Case → investigation | DONE | Tidak | Create/assignment/notes/evidence/status | `.cjs` Case + Playwright |

## 6. Security Result

`AuthGuard`, `RolesGuard`, `ModuleAccessGuard`, `RequiresModuleFeature`, dan subscription/tenant assignment tidak dilemahkan. Tes auth dan integration tetap mencakup 401 tanpa autentikasi, 403 modul/feature denied, pembatasan role, serta resource cross-tenant sesuai kontrak. Source observation memiliki relasi Indicator komposit `(indicatorId, tenantId)`; ingestion mengambil source tenant aktif dan menggunakan tenant yang sama untuk seluruh write. SUPER_ADMIN tetap memakai konteks tenant eksplisit pada route yang mensyaratkannya; ADMIN/USER memakai tenant sesi.

Status catalog dipertahankan: `indicator-management = IMPLEMENTED`, `intelligence-hub = IMPLEMENTED`, dan `export = CATALOG-ONLY`. Tidak ada aktivasi export atau feature catalog-only baru.

## 7. Test Result

| Gate | Command aktual | Hasil |
|---|---|---|
| Prisma | `cd backend && npx prisma validate && npx prisma migrate status` | PASS; 44 migrations, up to date |
| Backend build | `cd backend && npm run build` | PASS |
| Jest | `cd backend && npm test -- --runInBand --no-cache` | 19/19 suites; 188/188 PASS |
| TI `.spec.cjs` | `cd backend && node --test src/telegram/*.spec.cjs src/indicators/*.spec.cjs src/intelligence/*.spec.cjs src/cases/*.spec.cjs src/auth/*access*.spec.cjs src/auth/*feature*.spec.cjs` | 340 PASS, 0 FAIL |
| Frontend build | `cd frontend && npm run build` | PASS |
| TypeScript | `cd frontend && npx tsc --noEmit` | PASS |
| Targeted Playwright | `cd frontend && npx playwright test e2e/ti-phase1-qa.spec.ts e2e/telegram-ioc-candidates.spec.ts e2e/intelligence-sources.spec.ts e2e/intelligence-feeds.spec.ts e2e/intelligence-threat-actors.spec.ts e2e/intelligence-campaigns.spec.ts e2e/intelligence-mitre.spec.ts e2e/hub-modal-migration.spec.ts e2e/indicator-cases.spec.ts e2e/case-indicators.spec.ts e2e/cti-phase1-access.spec.ts --workers=2 --reporter=line` | 48 PASS, 0 FAIL; mocked browser API fixtures |
| Live providers | Tidak dijalankan | **LIVE PROVIDER = NOT VERIFIED** |

Playwright awal 20/48 karena fixture feature access lama; setelah koreksi targeted suite 48/48. Migration diterapkan dengan `npx prisma migrate deploy`. `prisma migrate dev --create-only` tidak dapat digunakan karena drift FK `User` yang sudah ada pada database lokal; database tidak di-reset. Proses Node yang memegang DLL membuat `prisma generate` default mendapat EPERM, jadi client dihasilkan di direktori sementara dan berkas generated disalin tanpa menimpa DLL yang sedang dipakai. Build dan tes dengan client baru lulus.

## 8. Files Changed

- Backend: `prisma/schema.prisma`, migration `20261006090000_ti_indicator_source_observation/migration.sql`, `indicator-feeds.service.ts`, `indicators.service.ts`, `cases.service.ts`, dan tes provenance baru.
- Frontend: daftar provenance pada detail Indicator dan Indicator terkait di Case; dua fixture Playwright memverifikasi tampilan multi-source.
- Fixtures integration: empat `.spec.cjs` untuk correlation, discovery, MITRE ingestion, dan Threat Actor ingestion.
- Fixtures Playwright: `case-indicators`, `hub-modal-migration`, `indicator-cases`, `intelligence-campaigns`, `intelligence-feeds`, `intelligence-mitre`, `intelligence-sources`, `intelligence-threat-actors`, dan `telegram-ioc-candidates`.
- Perubahan `frontend/DESIGN.md` sudah ada sebelum pekerjaan ini dan tidak diubah.

## 9. Migration

**Satu migration minimal, non-destruktif, telah diterapkan.** Schema lama hanya memiliki satu `Indicator.intelligenceSourceId`; ia tidak dapat menyimpan beberapa provenance per IOC. Migration menambah tabel observasi, FK, unique key, indeks, dan backfill sumber terakhir Indicator lama. Indicator dan relasi Case lama dipertahankan.

## 10. Remaining Limitations

- **TI V1 blocker:** Tidak ada blocker internal yang tersisa berdasarkan pengujian yang dijalankan.
- **Production-readiness:** Live URLhaus, MalwareBazaar, AbuseIPDB, dan VirusTotal belum diuji dengan kredensial/provider nyata. Lingkungan pengembangan lokal memiliki drift FK `User` terhadap history migration yang tidak disebabkan migration TI ini.
- **Enhancement/later:** Observasi tidak dapat mengembalikan provenance historis yang sudah tertimpa sebelum migration. Feed status runtime detail masih in-memory; source `lastSyncAt` dan observasi tetap persisten. Browser suite memakai mock API, sedangkan kontrak backend dibuktikan dengan integration DB/HTTP.
- **Visual existing:** Pada lebar 390px, tab `Evidence` di strip navigasi Case yang sudah ada terpotong. Baris provenance baru tetap terbaca tanpa clipping; masalah tab berada di luar perubahan TI ini.

## 11. Final Recommendation

**THREAT INTELLIGENCE V1 CLOSED**

**READY FOR NEXT MODULE/PHASE**

Fase berikutnya tidak dimulai dalam pekerjaan ini.
