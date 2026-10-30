# SICTI AppSec V1 — final closure audit (Cloud)

**Tanggal:** 2026-10-24  
**Repository/base:** `jafhdr/cti-app`, `main` (Git tree `4877dde1f7f17e7d845c861ca87e4ecebc29f233`)  
**Verdict: PARTIAL.** Implementasi yang diperiksa menunjukkan kontrol AppSec V1 yang konsisten, tetapi final closure belum dapat dinyatakan karena validasi eksekusi tidak tersedia di environment Cloud ini.

## Matriks audit

| Area | Implementasi dan kontrak aktual | Bukti yang diperiksa | Hasil |
| --- | --- | --- | --- |
| Applications | `GET /appsec/applications`, `GET /:id`, `POST /`, `PATCH /:id`; pencarian, filter, paginasi, audit create/update, nama unik per tenant | `applications.controller.ts`, `applications.service.ts`, `appsec.dto.ts`, model `Application`; tes HTTP di `appsec.integration.spec.cjs` | Terverifikasi statis; runtime belum divalidasi ulang |
| Findings | Daftar/detail, opsi Application, create manual, update, transisi status, resolution untuk status terminal, audit, outbox untuk high risk | `findings.controller.ts`, `findings.service.ts`, `finding-lifecycle.ts`, `appsec-finding-event.ts` (referensi), tes HTTP AppSec | Terverifikasi statis; runtime belum divalidasi ulang |
| Posture | Total dan distribusi severity/status serta top Application dihitung dengan `tenantId` | `posture.controller.ts`, `posture.service.ts`, tes agregasi HTTP | Terverifikasi statis; runtime belum divalidasi ulang |
| Access control | Auth, role, module, dan feature guard di seluruh controller; mutasi hanya `SUPER_ADMIN`/`ADMIN`; fitur berbeda untuk inventory, finding, posture | Controller AppSec, `module-access.guard.ts`, `module-access.service.ts`, tes role/feature HTTP, shell frontend | Terverifikasi statis; runtime belum divalidasi ulang |
| Tenant isolation | Service menyelesaikan tenant dari sesi; `SUPER_ADMIN` wajib memilih tenant; query entity memakai `tenantId`; relasi AppSec memakai foreign key komposit `(id, tenantId)` | `tenant-context.ts`, service AppSec, model Prisma, tes tenant HTTP | Terverifikasi statis; runtime belum divalidasi ulang |
| ASM | Daftar/taut/lepas Asset memeriksa entitlement `asset-management` dan tenant kedua entity; exposure Finding memakai relasi Application | `application-assets.*`, `finding-integrations.service.ts`, tes HTTP ASM | Terverifikasi statis; runtime belum divalidasi ulang |
| TI | Taut/lepas Vulnerability yang sudah ada, daftar kandidat, dan baca konteks memeriksa entitlement `intelligence-hub` serta tenant kedua entity | `finding-integrations.*`, model relasi, tes HTTP TI | Terverifikasi statis; TI V2 lokal tidak diperiksa |
| Case | Buat/ambil Case dari Finding memeriksa entitlement `case-workflow`; transaksi dan tautan satu-ke-satu; tes mencakup concurrent create dan rollback | `finding-case.service.ts`, model relasi, tes HTTP Case | Terverifikasi statis; runtime belum divalidasi ulang |
| Frontend | Halaman Overview, Applications, Findings, detail, form, dan konteks ASM/TI/Case memakai endpoint AppSec; UI memeriksa role, feature, dan tenant | `frontend/app/appsec`, `frontend/components/appsec`, tiga spec Playwright terisolasi dan satu live spec | Terverifikasi statis; browser belum divalidasi ulang |

## Kontrak dan cakupan tes

Kontrak API diambil dari controller, DTO, service, dan pemanggil frontend pada `main`, bukan dari laporan Phase 6. Tes HTTP AppSec yang tersedia mencakup auth/role/feature, CRUD, tenant, relasi lintas modul, lifecycle, audit, notifikasi, dan posture. Tes Playwright mencakup alur role, tenant switch, state kosong/error, dan ukuran layar; `appsec-live.spec.js` menargetkan backend dan PostgreSQL nyata. Keberadaan tes ini **bukan** bukti bahwa tes lulus pada audit ini.

## Perubahan kode

Tidak ada perubahan kode. Audit statis tidak menemukan blocker implementasi AppSec yang dapat diperbaiki dengan aman dan dibuktikan tanpa menjalankan ulang tes. Dokumen ini adalah satu-satunya file yang ditambahkan. Prisma schema/migration, auth bersama, module access, shared navigation, dan TI V2 tidak diubah.

## Hasil validasi Cloud

| Pemeriksaan | Hasil | Bukti/keterbatasan |
| --- | --- | --- |
| `node --check backend/src/appsec/appsec.integration.spec.cjs` | PASS | Sintaks CJS valid |
| `node --check frontend/e2e/appsec-live.spec.js` | PASS | Sintaks JS valid |
| `npm test -- --runInBand src/appsec/appsec.integration.spec.cjs` (backend) | SKIPPED (environment) | Dicoba; `jest: not found` |
| `npm run build` (backend) | SKIPPED (environment) | Dicoba; `nest: not found` |
| `npm run typecheck` (frontend) | SKIPPED (environment) | Dicoba; `tsc: not found` |
| `npm run build` (frontend) | SKIPPED (environment) | Dicoba; `next: not found` |
| Playwright AppSec, live HTTP/DB, regresi terkait | SKIPPED (environment) | Checkout dari GitHub API hanya berisi file relevan; dependency dan database tes terisolasi tidak tersedia. Database localhost/production tidak digunakan. |

Environment Cloud awalnya kosong; Git biasa dan npm registry gagal menghubungi proxy (`Failed to connect to proxy port 8080`). File relevan `main` diambil melalui konektor GitHub untuk audit. Karena checkout penuh dan dependency tidak tersedia, hasil typecheck/build dan regresi tidak dapat disimpulkan dari pemeriksaan statis.

## Blocker dan limitations

1. **Blocker final closure:** jalankan targeted HTTP AppSec, Playwright AppSec (termasuk live), typecheck, build backend/frontend, dan regresi integrasi pada checkout `main` penuh dengan dependency dan PostgreSQL tes **terisolasi**, lalu tinjau hasilnya. Tidak ada klaim `CLOSED` sebelum bukti tersebut tersedia.
2. `CTI.pdf` dan `sicti.md` tidak ada pada tree repository `main` yang diperiksa. Persyaratan dari kedua dokumen tidak diasumsikan.
3. Perubahan TI V2 yang belum di-commit tidak tersedia dalam environment ini. Kontrak TI yang diperiksa adalah kontrak `main` saja; kompatibilitas terhadap TI V2 belum dapat dinilai.
4. Audit ini tidak mengeksekusi migrasi, seed, worker notifikasi, atau browser. Bukti Phase 6 sebelumnya tidak dijadikan pengganti hasil run saat ini.

## Risiko integrasi dan tahap berikutnya

TI V2 dapat mengubah bentuk/akses Vulnerability atau kontrak `intelligence-hub` yang dipakai `FindingIntegrationsService` dan `FindingIntegrations`. Setelah TI V2 tersedia dalam branch integrasi, bandingkan kontrak endpoint/model/entitlement, lalu jalankan ulang tes lintas modul dan browser. Bila perubahan memerlukan shared schema/API, rencanakan pekerjaan integrasi terpisah dan minta persetujuan sebelum mengubahnya. Setelah gate validasi hijau, perbarui dokumen ini dengan hasil dan nilai ulang verdict.
