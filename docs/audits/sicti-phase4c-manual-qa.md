# SICTI Phase 4C Manual QA Matrix

Date: 2026-11-14
Scope: read-only visual/functional review of the supplied authenticated monitoring captures.

## surfaceEvidence

| Scenario | Criterion reference | Surface | Exact invocation | Verdict | artifactRefs |
|---|---|---|---|---|---|
| P4C-VIS-01 | 4C-UI-01 screenshot integrity | PNG artifact files | `node -e` PNG signature/IHDR/IEND check; `view_image` on desktop and mobile PNGs | PASS | A1, A2, A3 |
| P4C-VIS-02 | 4C-UI-02 responsive monitoring layout | Browser-rendered desktop/mobile screenshots | `view_image` on `sicti-phase4c-monitoring-desktop.png` and `sicti-phase4c-monitoring-mobile.png` | PASS | A1, A2 |
| P4C-FUNC-01 | 4C-FUNC-01 connector/status/history | Authenticated monitoring workspace | `view_image` on both screenshots; direct read of `sicti-phase4c-browser-evidence.json` | PASS | A1, A2, A4 |
| P4C-FUNC-02 | 4C-FUNC-02 findings/review/Alert/Case | Authenticated evidence queue and review card | `view_image` on both screenshots; direct read of browser evidence JSON | PASS | A1, A2, A4 |
| P4C-PRIV-01 | 4C-PRIV-01 privacy-safe evidence display | Authenticated monitoring workspace | `view_image` on both screenshots; inspect evidence-reference fields and JSON privacy flag | PASS | A1, A2, A4 |

## adversarialCases

| Scenario | Criterion reference | Adversarial class | Expected behavior | Verdict | artifactRefs |
|---|---|---|---|---|---|
| P4C-ADV-01 | 4C-UI-01 | malformed/partial capture | Invalid signature, missing PNG terminator, or dimension corruption must be rejected; supplied captures must be complete | PASS | A1, A2, A3 |
| P4C-ADV-02 | 4C-UI-02 | narrow viewport overflow/clipping | Mobile cards and controls must stack/wrap without horizontal clipping; supplied 390px capture remains legible | PASS | A2 |
| P4C-ADV-03 | 4C-FUNC-02 | missing downstream linkage | Finding review must expose confirmed state plus Alert/Case linkage; supplied evidence shows both | PASS | A1, A2, A4 |
| P4C-ADV-04 | 4C-PRIV-01 | sensitive evidence leakage | UI must use opaque/synthetic references and avoid raw provider credentials or underground URLs | PASS | A1, A2, A4 |

## Findings

- Desktop capture shows the complete monitoring flow: watchlist, authorized provenance, active scheduled connector, successful collection history, confirmed finding, review history, linked Alert/Case, and safe evidence reference.
- Mobile capture preserves the same information hierarchy at 390px: controls stack vertically and long identifiers wrap inside their cards; no clipped card edge or horizontal overflow is visible.
- The UI displays `qa://simulator/...` plus a SHA-256 digest and synthetic QA labels. No raw provider credential or live underground source is visible.
- Browser evidence records `authenticated`, `tenantWatchlist`, `authorizedSimulator`, `scheduledCollection`, `syntheticObservation`, `matched`, `evidence`, `reviewed`, `alertLinked`, `caseLinked`, and `operatorRedaction` as true, with `screenshots: 2`.

## Artifact references

| ID | Kind | Description | Path |
|---|---|---|---|
| A1 | screenshot | Phase 4C authenticated monitoring desktop capture, 1365×2402 PNG | `.sicti-flagship-baseline/docs/audits/sicti-phase4c-monitoring-desktop.png` |
| A2 | screenshot | Phase 4C authenticated monitoring mobile capture, 390×3428 PNG | `.sicti-flagship-baseline/docs/audits/sicti-phase4c-monitoring-mobile.png` |
| A3 | command-output | Read-only PNG signature/IHDR/IEND validation: both files have PNG signature `89504e470d0a1a0a`, valid IHDR, expected dimensions, and IEND terminator | captured in this QA run; summarized above |
| A4 | json | Phase 4C browser evidence flags and screenshot count | `.sicti-flagship-baseline/docs/audits/sicti-phase4c-browser-evidence.json` |

Overall functional visual pass: PASS.
