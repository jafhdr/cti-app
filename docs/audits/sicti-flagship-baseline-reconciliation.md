# SICTI flagship development baseline reconciliation

Date: 9 November 2026 (Asia/Jakarta). **Verdict: BASELINE READY** for the first correlation pilot. No pilot implementation is included.

## Baseline and preservation

- Isolated candidate: `C:/Users/AN515 57/Downloads/cti app/.sicti-flagship-baseline` (detached HEAD at `f3b91ad2d4d8e0370f729b462cff32ad62fcaac9`). GitHub `jafhdr/cti-app` `main` was verified through the GitHub compare API as seven commits ahead of the original checkout's `4877dde` and equal to this base.
- The candidate retains the committed ASM V2 and Case V2 descendant branch content from `feature/case-v2-lifecycle` (`4b0ce04`, `5d06bfc`, `60078b2`): 99 changed paths relative to GitHub `main`, listed in `sicti-baseline-retained-branch-files.txt`. That branch descends from `f3b91ad` and contains ASM V2. TI V2 and AppSec V2 remain supplied by `main`.
- Original dirty `main` and all existing worktrees remain untouched. No commit, merge, push, reset, stash, production integration, or active-database change occurred. The candidate carries its changes as uncommitted worktree files.

## Reconciliation inventory

`sicti-baseline-file-inventory.csv` records 132 local source/migration file comparisons with normalized Git blob IDs and classifications: **73 ALREADY UPSTREAM**, **9 LOCAL-ONLY**, **2 CONFLICTING**, **48 UNRELATED**. Generated build output, QA artifacts and documentation outside the source/migration comparison are not copied; they remain in the original checkout. For `20261023150000_analysis_reporting/migration.sql`, local and upstream SQL text is identical; the raw blob difference reflects CRLF versus the newer `.gitattributes` normalization. The upstream migration is retained unchanged.

The two material code conflicts are `backend/prisma/schema.prisma` and `backend/src/intelligence/campaigns.service.ts`. The original checkout's schema lacks AppSec V2 lifecycle fields/models already on GitHub `main`; using that local schema would remove AppSec V2. Its campaign creation also omits `tenantId` on MITRE technique links, while upstream includes it. The candidate uses the upstream versions and the ASM/Case branch's additive changes. The nine local-only backend files are QA background-worker isolation changes; they are preserved in the original checkout but not required for this baseline. The 48 UI/UX differences are classified UNRELATED to the source baseline and remain preserved in the original checkout. No local file was overwritten.

## Migration integrity

GitHub `main` contributes TI V2 and AppSec V2 migrations. The ASM/Case descendant adds eight migrations. The eight new migration files were copied byte-for-byte from the existing Case V2 worktree after Windows checkout line-ending conversion was detected; no migration SQL was edited. A fresh, uniquely named disposable PostgreSQL QA database applied all **76 migrations**; `prisma migrate status` reported **up to date**. The eight new files' SHA-256 values matched their `_prisma_migrations.checksum` rows (**8/8**). Both disposable QA databases used during validation were dropped. No active database was modified.

## Validation

| Check | Result |
| --- | --- |
| `git diff --check` in candidate | Pass |
| Prisma schema validate and client generate | Pass, using cached Prisma 6.19.3 engine binaries in candidate `node_modules` |
| Backend `npm run build` | Pass |
| Backend Jest unit suite | **23 suites, 205 tests passed** |
| Frontend `npm run typecheck` and production `npm run build` | Pass; build required process-spawn permission after sandbox `EPERM` |
| Focused TI, ASM V2 and Case Node integration suite on disposable database | **47 tests passed, 0 failed** |
| Fresh disposable database migration deploy/status and checksums | **76/76 migrations applied; 8/8 ASM/Case checksums matched** |

One existing feed-provenance integration fixture initially failed in teardown because it deleted a tenant while a Case and User still referenced it under restrictive foreign keys. The candidate-only test change in `backend/src/indicators/indicator-feeds.provenance.integration.spec.cjs` deletes the fixture Case and User before the tenant; the focused suite then passed. This is the sole additional change beyond the 99 retained branch paths. Initial ASM runs also rejected a generic QA database name by fixture design; the final suite used a disposable name with the required `cti_asm61_qa_` prefix.

## Limits and next task

The candidate is detached and uncommitted by request. The original checkout's unrelated local UI/UX and QA isolation work was preserved but not integrated; future work requiring those changes needs separate review. This validation covers builds, unit tests, focused database integration tests and migration consistency, not deployed behavior or the full browser E2E matrix. No 60-second performance claim follows from these results.

**Exact next development task:** in this isolated candidate, define a tenant-scoped normalized threat-event contract and failing tests, then implement one deterministic correlation path from an existing feed IOC to synthetic internal telemetry, with provenance, confidence, deduplication, time-window rules, alert timestamps and an isolated end-to-end QA scenario. Do not start until a new instruction authorizes the pilot.
