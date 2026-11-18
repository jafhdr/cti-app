# PR #7 final pre-commit review (Phase 5B)

**Date:** 2026-11-17 (Asia/Jakarta)\
**Candidate:** `integration/sicti-flagship-candidate` at `797cbb9669c24b9f9cfbf70c93e04cfa90f9d8a6`\
**Verdict:** **APPROVED FOR STAGING** after the focused sict48 database guard correction. This does not approve a commit, PR update, merge, or claim remote CI passed.

## Exact snapshot and history

The [staging allowlist and full snapshot](sicti-pr7-final-staging-allowlist.csv) records Git status, byte length, SHA-256, classification, staging decision, and proposed commit group for **229** changed paths: **22 tracked modifications and 207 untracked files**, including this report. Of those, **56 are proposed for publication and 173 are excluded**. The CSV cannot contain its own stable SHA-256 without a self-reference cycle, so it is the sole exception to the CSV inventory; include it by explicit path at staging and record its final byte size/hash in the handoff. Current Git status therefore contains **230** paths including the CSV. The prior [Phase 5A prechange inventory](sicti-pr7-ci-prechange-inventory.csv) provides a second baseline for 224 earlier paths. No baseline file was modified or deleted.

The existing three PR commits remain `57e108996a4e929d8a63e92521b3242cab051e72` (backend and migrations), `0e8b4c2d9d3a452cdd91e16fe80888a3e63669c0` (frontend), and `797cbb9669c24b9f9cfbf70c93e04cfa90f9d8a6` (audit). Their parent is `f3b91ad2d4d8e0370f729b462cff32ad62fcaac9`, matching local `origin/main` at review. `git rev-list --left-right --count HEAD...origin/main` returned `3 0`. These facts are from local refs only; recheck the remote main SHA immediately before any future PR update. `git diff --cached --name-only` was empty. No migration is modified in the current worktree, and `git diff --check` passed with only existing LF/CRLF warnings.

| Classification | Count | Stage decision |
| --- | ---: | --- |
| Required application implementation | 24 | 24 YES |
| Required automated regression test or CI dependency | 7 | 7 YES |
| Required GitHub Actions configuration | 1 | 1 YES |
| Essential sanitized QA report/evidence | 24 | 24 YES |
| Optional historical evidence | 163 | 163 NO |
| Local-only temporary or sensitive QA state | 10 | 10 NO |

The implementation and test rows preserve Monitoring–Case atomicity, Correlation Alert–Case endpoints, the Case allocator, and the accepted frontend reconciliation. The 24 evidence rows contain nine concise reports (including this one), three sanitized browser assertion JSON files, and twelve representative screenshots. The other 131 images, raw test/build logs, duplicate browser captures, old inventories, and local mock state stay untracked and excluded. In particular, never stage `backend/.qa-phase3c-state/` or `backend/qa-sict39-state.json`, and never use `git add -A` in this worktree.

## Publication and privacy scan

All 44 proposed text files in the snapshot were scanned for private-key blocks, GitHub/AWS token shapes, JWTs, bearer and cookie values, database URLs, password/secret assignments, and non-test email domains. Twelve selected PNGs were inspected for embedded metadata; none had metadata fields. The scan found no live secret material. Three workflow PostgreSQL URLs use synthetic credentials and localhost disposable databases. Two backend code matches are the literal `postgresql://invalid/disabled` fallback. Browser evidence email domains are `example.test`; `frontend/DESIGN.md` contains the established public contact domain `sisi.sig.id`. Synthetic QA IDs and timestamps appear in selected evidence. Re-run a dedicated scan on actual staged bytes before committing; this working-tree scan cannot prove the later staged set is identical.

## CI dependency and first-run review

The [workflow](../../.github/workflows/sicti-ci.yml) names four checks: `Backend build and unit tests`, `Frontend typecheck and build`, `Migrations and core regressions`, and `Monitoring Case atomicity`. Five referenced integration tests are marked `YES` in the CSV: `access.integration.spec.cjs`, `correlation-case.http.integration.spec.cjs`, `case-number-concurrency.integration.spec.cjs`, `case-number-workflows.integration.spec.cjs`, and `monitoring-case-concurrency.integration.spec.cjs`. The other two (`correlation.http.integration.spec.cjs`, `correlation.security.integration.spec.cjs`) and both package lockfiles already exist in the three-commit HEAD. All seven test paths are therefore present in the proposed commit tree.

The workflow specifies Node 22, PostgreSQL 16, separate service databases named `cti_corr_qa_sict40` and `cti_phase4a_qa_sict36ci`, and synthetic JWT/seed/DB values. The names satisfy the Correlation, Case allocator, and Monitoring harness guards. The first database receives the module seed; the Monitoring concurrency harness creates its own fixture. Real SOAR, monitoring collector, Telegram polling, and external connectors remain disabled. `pull_request` targets `main`, token permission is `contents: read`, checkout credentials are not persisted, and there is no `continue-on-error`. The fresh database migration deploy is repeated and followed by migration status. Local YAML parsing, test path checks, Prisma validation, and 35 Jest suites/261 tests passed in Phase 5A. Focused Phase 5B validation found both lockfiles pass `npm ci --dry-run --ignore-scripts`, the backend build passes, all seven named CJS test paths pass `node --check`, and their compiled imports exist. No Linux Node 22/PostgreSQL 16 end-to-end or remote GitHub Actions run has occurred. Mutable `@v7` action tags are a non-blocking supply-chain hardening item; consider verified SHA pins before a high-assurance release.

**Resolved staging blocker (sict48):** `backend/src/auth/access.integration.spec.cjs` now checks `SICTI_ISOLATED_QA=true` and a present, parseable PostgreSQL URL before loading Nest/Prisma test modules. It accepts only `localhost`, `127.0.0.1`, or IPv6 loopback and a database matching `cti_corr_qa_[a-z0-9_]+`; it rejects URL query/fragment overrides. This rules out the active `cti`, default PostgreSQL databases, malformed/missing URLs, non-QA names, remote hosts, and implicit fallback to the development `.env`. The workflow already supplies the compatible `cti_corr_qa_sict40` URL and QA flag, so no workflow edit was needed. `node --check` passed. Eight negative subprocess checks rejected missing URL, active `cti`, missing flag, false flag, malformed URL, non-QA database, remote host, and query override before database connection. A new disposable `cti_corr_qa_sict48_*` database received all 91 existing migrations and the synthetic module seed; the focused authenticated access/tenant test passed **17/17** subtests, including individual feature revocation, foreign-tenant denial, and root tenant selection. The disposable database was dropped. No active `cti` connection was made.

The Correlation–SOAR HTTP test is proposed for the backend commit because it is accepted Phase 3 evidence, but it is **manual-only** today: it reads excluded `backend/qa-sict39-state.json` and requires the local sandbox mock. It is not named by CI and is not clean-checkout reproducible. Do not describe it as a CI check or stage its local state; a later self-contained fixture would be required to promote it into CI.

## ASM discovery-history triage

The Phase 4B error remains **unconfirmed**. `DiscoverySchedule` combines GET requests for `schedule`, `runs`, and `changes` and emits the same message if any fails. All three backend routes exist, but their controller requires the `asset-discovery` feature separately from asset inventory. The disposable sict45 fixture and server logs were removed, and the retained browser record lacks those response statuses. A fixture entitlement gap is probable; an application defect has not been ruled out. Focused follow-up: create an isolated QA tenant with an explicit `asset-discovery` feature grant and asset, authenticate as that tenant, capture all three GET statuses/bodies and the rendered history, then compare with the same request lacking the grant. No application change or active database access is part of this review.

## Proposed commit groups and exact staging source

Use the CSV `stage=YES` rows as the exact path list, grouped by `commit_group`; the table contains each path and checksum. Proposed messages follow the existing `feat(...)` / `docs(...)` style:

1. **backend — 15 paths:** `fix(backend): make Case links and numbers atomic`.
2. **frontend — 16 paths:** `feat(frontend): reconcile SICTI workspaces and responsive UX`.
3. **ci — 1 path:** `ci: validate SICTI builds migrations and regressions`.
4. **evidence — 24 CSV paths including this report, plus the CSV itself:** `docs(audit): consolidate PR 7 QA and commit evidence`.

At the later authorized staging step, select each CSV group by exact `path` values. Before each commit inspect `git diff --cached --stat` and the staged diff, run `git diff --cached --check`, re-run the secret/privacy scan over staged bytes, and compare staged hashes with the CSV. The final documentation group must also include the CSV by explicit path. Refresh the allowlist if any further correction changes a file's checksum. Confirm `origin/main` again and require actual green remote checks before any merge decision. No files were staged or committed in Phase 5B.

## Remaining limitations

No confirmed staging blocker remains after sict48. Remote CI has not run; Node 22/Linux/PostgreSQL 16 behavior is unproven. The SOAR HTTP harness remains manual-only, and the ASM history error needs the focused entitlement/status capture above. The latter two do not establish a new application defect. A future failed CI run or staged secret scan finding must be reviewed before any commit or PR update.
