# Case Management v1 Closure

Tanggal: 7 Oktober 2026 (Asia/Jakarta).

## Verdict

**CASE V1 CLOSED WITH LIMITATIONS. CASE MANAGEMENT V1 CLOSED.** Implementasi lifecycle dan batas tenant telah diverifikasi pada build, unit, integration, dan browser suite lokal. Ready for AppSec Posture v1 sebagai fase terpisah.

## Contract

- Case baru selalu berstatus `OPEN`. Transisi yang diizinkan: `OPEN → IN_PROGRESS → RESOLVED → CLOSED`, serta `RESOLVED → IN_PROGRESS`. `CLOSED` terminal. Perubahan status mencatat `CASE_STATUS_CHANGED` dengan `fromStatus`, `toStatus`, actor, dan waktu; edit field lain tetap memakai `CASE_UPDATED`.
- SUPER_ADMIN membuat Case dari Indicator pada tenant workspace yang dipilih. Tanpa pilihan tenant request ditolak; Indicator tenant lain disembunyikan. ADMIN memakai tenant sesi. Pergantian tenant pada UI mengganti state workspace Case.
- Assignee wajib aktif dan berada pada tenant Case, baik saat create, edit, maupun assignment.
- Case menampilkan relasi Indicator beserta provenance sumber TI yang sudah tersimpan. Relasi konteks ASM Finding tetap tersedia; tombol langsung Finding → Case di UI berada di luar v1.
- `alert-triage = CATALOG-ONLY` dan bukan requirement Case Management v1.

## Regression

| Gate | Hasil |
|---|---|
| `npx prisma validate`; `npx prisma migrate status` | PASS; 44 migrations, up to date |
| Backend `npm run build` | PASS |
| Jest `npm test -- --runInBand --no-cache` | 191/191 PASS, 19/19 suites |
| Backend `npm run test:integration` | 35/35 PASS |
| Targeted Case `.spec.cjs` | 56/56 PASS |
| Frontend `npm run build`; `npm run typecheck` | PASS |
| Targeted Case Playwright | 30/30 PASS; mocked API fixtures |

## Remaining limitations

- Browser regression memakai mock API. Validasi live browser terhadap backend production belum dilakukan.
- Direct ASM Finding button dan implementasi `alert-triage` tidak termasuk v1.
- Provenance TI historis yang sudah tertimpa sebelum migration TI tidak dapat direkonstruksi; lihat laporan closure TI v1.
