# PR #7 frontend CI lockfile remediation

Updated: 2026-11-19 (Asia/Jakarta)
Branch: `integration/sicti-flagship-candidate`; HEAD `6aa57843e29c32a4d69e1586ab0cb70276376066`. Draft PR #7 remains unchanged by this work.

## Confirmed failure and cause

GitHub Actions run `44222104132` failed in two jobs at frontend installation: `Frontend typecheck and build` (`npm ci --prefix frontend`) and `Migrations and core regressions` (`npm ci --prefix frontend --ignore-scripts`). Both logs report `Invalid: lock file's picomatch@2.3.2 does not satisfy picomatch@4.0.7` and `Missing: picomatch@2.3.2 from lock file`. The runner used Node `v22.23.4` and npm `10.9.9`.

A package-only directory with no `node_modules` reproduced the exact error in Linux `node:22.23.4-bookworm-slim`. The original lockfile placed `picomatch@2.3.2` at the root and `picomatch@4.0.7` below `@dotenvx/dotenvx`. Linux npm's ideal tree requires root `4.0.7` and `2.3.2` below `micromatch`. The dependency manifest was already consistent; Windows npm accepted the old tree, which explains the earlier local false negative.

## Repair

In the clean Linux copy, `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` produced a passing tree. Its output also rewrote metadata for unrelated optional platform packages. The repository change selects only the three npm-generated `picomatch` placements: remove the nested `@dotenvx/dotenvx` copy, put `4.0.7` at the root, and put `2.3.2` below `micromatch`. `frontend/package.json` and all other dependency versions, registry URLs, and integrity values are unchanged. The `frontend/package-lock.json` diff is 16 insertions and 16 deletions.

The subsequent clean-checkout TypeScript failure came from `frontend/e2e/module-access-control.spec.ts`: it imports Prisma Client and bcrypt from `../../backend/node_modules`. The frontend job previously installed only frontend dependencies, so Prisma Client was absent. The job now runs `npm ci --prefix backend` and `npx prisma generate` using the existing backend schema before frontend installation and typecheck. It retains Node 22, frontend `npm ci`, typecheck, build, read-only token permission, and `persist-credentials: false`. No E2E exclusion or TypeScript suppression was introduced.

## Verification

In a disposable fresh checkout of tracked backend and frontend files, with no pre-existing `node_modules`, under Linux Node `v22.23.4`/npm `10.9.9`:

- `npm ci --prefix backend --no-audit --no-fund`: passed, 633 packages installed.
- `npx prisma generate` from `backend`: passed, Prisma Client `v6.19.3` generated from the existing schema. The slim container warned that OpenSSL detection defaulted to 1.1.x; generation still exited successfully.
- `npm ci --prefix frontend --no-audit --no-fund`: passed, 361 packages installed.
- `npm ci --prefix frontend --ignore-scripts --no-audit --no-fund`: passed, 361 packages installed.
- `npm ls picomatch --prefix frontend --all`: root/deduplicated `4.0.7` for `@dotenvx/dotenvx` and `fdir`; nested `2.3.2` for `micromatch`.
- `npm run typecheck --prefix frontend`: passed after backend installation and Prisma generation; no TypeScript errors remained.
- `npm run build --prefix frontend`: passed; 48 static pages generated.

The database-regressions job retains its repaired-lockfile frontend install with `--ignore-scripts`. All four job names and intended coverage remain in the workflow. The intended repository changes are limited to `frontend/package-lock.json`, `.github/workflows/sicti-ci.yml`, and this report. Backend dependency files, application logic, Prisma schema/migrations, and prior commits remain unchanged. No commit, push, PR update, or database access occurred.

## Remaining remote gate

Commit review and a new GitHub Actions run at the resulting PR head are still required. Local Linux validation does not establish remote CI success or merge readiness.
