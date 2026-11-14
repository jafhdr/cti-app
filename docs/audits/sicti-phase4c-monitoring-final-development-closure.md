# SICTI Phase 4C — Monitoring Sandbox Final Development Closure

**Date:** 2026-11-14 (Asia/Jakarta)\
**Verdict:** **MONITORING SANDBOX DEVELOPMENT CLOSED**. This verdict covers synthetic, isolated QA only. It is not a production-readiness or live dark-web coverage decision.

## Final capabilities

The Phase 4A/4B monitoring architecture now supports tenant-scoped domain, brand, and approved identity watches; an authorized local simulated provider; versioned, HMAC-signed connector requests and responses; scheduled durable collection jobs; bounded retry, timeout, lease recovery, replay suppression, and collection history. Synthetic observations retain source provenance, provider publication and local collection timestamps, TLP, retention deadline, and an opaque `qa://` evidence reference with integrity digest. Matching creates explainable findings. Analysts can review findings and link confirmed results to Alerts and Cases. The existing Monitoring workspace displays connector health, freshness, history, and separate local collection and processing latency.

Phase 4C added focused lifecycle and workload tests, authenticated Chrome redaction verification, and a small Case Management transaction correction found while running the full regression matrix. No new Prisma migration or live connector was added.

## Security and privacy verification

- Collection remains disabled by default and requires all three isolated QA flags, a `cti_phase4a_qa_*` database, the fixed loopback connector path, and an adequate QA secret. The active `cti` database was not modified. No real leaked credential or production provider credential was used.
- Tenant-separated, versioned HMAC identity digests were verified across tenants and key versions. An observation using the new key matched an older keyed watch while its old key remained available. A legacy unkeyed watch could not be reactivated; re-enrollment created a new keyed watch. Identity plaintext was transient; persisted watch labels were masked.
- Invalid simulator signatures, cross-tenant source operations, disabled collection, manual rate limits, TLP RED visibility, and role restrictions were exercised by Phase 4A/4B HTTP/integration tests. Existing append-only review and audit records remain intact.
- Expired synthetic observation fields and evidence references were scrubbed by the scheduled retention method, with an audit event. Operator redaction required a reason, hid the finding, and retained its audit history. The authenticated Chrome scenario also verified redaction after Alert/Case linkage.
- Evidence remains a `qa://` reference and digest, without a real evidence blob or resolver. Production deletion and encryption policy are still separate prerequisites.

## Reliability and retention results

The [sustained workload evidence](sicti-phase4c-workload-evidence.json) used **12 synthetic authorized sources** in one isolated tenant. Initial queue depth was 12; six worker cycles completed all 12 jobs and produced 12 observations in **5,790 ms**. Five retries occurred under the simulator's 5-request/second limit; zero jobs failed. Successful local collection latency ranged **2–4 ms**, and processing latency **15–28 ms**. These local QA measurements exclude upstream provider publication delay and cannot predict live-provider performance.

The PostgreSQL connector test passed scheduled collection, fail-once retry, expired-lease replay through a newly constructed worker instance, idempotence, HMAC rotation, legacy re-enrollment, expiry scrub, audited redaction, a 3-second request timeout, and source revocation during a pending retry. Revocation prevented a new observation; the pending job remained retryable until its bounded terminal attempt. The restarted worker reused durable request identity, so the repeated provider event did not duplicate the observation.

## Complete guarded cross-phase regression matrix

| Area | Fresh result and QA boundary |
| --- | --- |
| Phase 1C correlation | HTTP and machine security **2/2 passed** on `cti_corr_qa_soar_20261110135049`. |
| Phase 2A–2C | TTP/next-step PostgreSQL **6/6 passed** on `cti_phase2b_qa_soar_20261110135049` with fresh synthetic actor fixture. Phase 2C validation logic also passed in the full unit suite. |
| Phase 3A–3C | Playbook approval **1/1**, sandbox connector **1/1**, and restart/recovery **1/1 passed** on `cti_soar_qa_20261110133159`. Loopback mock child processes required an approved unsandboxed test invocation after sandbox `spawn EPERM`. |
| Phase 4A/4B | Monitoring HTTP **1/1** and collector/lifecycle **1/1 passed** on `cti_phase4a_qa_20261111`, each with a fresh fixture because the Phase 4A test revokes its source. |
| ASM V2 | P1A–P1C HTTP **3/3 passed** on isolated `cti_asm62_qa_case20_615aab3a` after synthetic seed; P1D **1/1 passed** on newly created `cti_asm62_qa_20261029_0930` with all 90 migrations and synthetic seed. |
| Case Management | V1 Node **56/56 passed**; V2 P1A, P1B, P1C, and P1D **4/4 passed** on disposable `cti_case_v2_audit_qa_20261031`, including P1C **91 checks** with `connection_limit=1` after the transaction fix. |
| Full app | Isolated `AppModule` startup and authenticated monitoring request **1/1 passed** with `connection_limit=1`. |
| Schema/builds/units | Prisma schema valid; monitoring QA database at **90 migrations, up to date**. Backend Nest production build, frontend TypeScript, and Next production build passed. Backend Jest **33/33 suites, 242/242 tests passed**. |

During the matrix, two older assertions were aligned with established security behavior: unapproved SOAR execution returns 409, and Case routes include the closed-case mutation guard. The Case P1C run reproducibly returned 500 with a single connection because `CasesService` queried entitlement through its outer Prisma client inside an interactive transaction. Moving those lookups before the note/evidence transactions made P1C pass with one connection. This is a small preservation fix; no Case workflow was expanded.

## Authenticated desktop/mobile evidence

[Chrome execution evidence](sicti-phase4c-browser-evidence.json) reports **PASS** for login → brand watch → authorized simulated source → due schedule → synthetic observation/finding → review and confirmation → Alert/Case links → operator redaction. Full-page [desktop](sicti-phase4c-monitoring-desktop.png) and [390 px mobile](sicti-phase4c-monitoring-mobile.png) screenshots were captured before redaction to preserve the evidence detail and linked outcome in the visual record. The subsequent API assertion confirmed the redacted finding is no longer visible. Functional and fidelity QA passed on the fresh captures; see [manual QA](sicti-phase4c-manual-qa.md) and `.omo/evidence/phase4c-monitoring-clone-fidelity.md`. One low-priority inherited UI caveat remains: a null-latency fallback glyph was not exercised in this capture.

## Production integration prerequisites

Before any external source is activated, separately verify provider authorization, license, permitted collection scope, service terms, and data-handling rights; use a least-privilege credential vault with rotation and incident revocation; establish authenticated transport and endpoint allowlists; validate provider coverage and publication delay independently; implement encrypted evidence storage/resolution, retention/purge and deletion proofs, and a managed HMAC key rotation/re-enrollment procedure; and add operational metrics, alerting, capacity tests, and failure runbooks in staging. Old HMAC keys must remain available while older keyed watches are active. The sandbox's shared secret, fixed simulator contract, synthetic coverage label, and local latency numbers are not production controls or coverage evidence.

**Next recommendation only:** perform a final assessment of all four SICTI flagship capabilities against `Product_SISI.pdf`, with demonstrated sandbox functionality and production readiness reported separately. That assessment was not started in Phase 4C. No commit, push, merge, deployment, live provider, or external collection occurred.
