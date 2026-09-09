# Thermo review resolution map

Status: all JP-01–JP-17 implementation findings are resolved at **`24fb97e9bd01ff706bd28e6904d6e270cb7cccb6`**, with final error-announcement corrections at release source **`e8920e1e643b4e90d05b4d2679f41e38964e7af1`**, both pushed on Thermo. Fresh-checkout verification, [integrated Windows/Linux CI](https://github.com/bornayo7/jobpilot/actions/runs/34412569273), and [final source CI](https://github.com/bornayo7/jobpilot/actions/runs/34413294480) pass. The qualification limits below define the release scope. Documentation-only commits after the release source do not change its implementation.

The [original review](CODEBASE_REVIEW.md) is pinned to `c73bd2c`; its line numbers and baseline failures are historical. The [approved plan](OVERHAUL_PLAN.md) retains the complete release gates. Paths below identify current implementation and tests, not the original probe harnesses.

| Finding | Implemented response | Maintained evidence to run |
|---|---|---|
| JP-01 | Separate ATS/LinkedIn declarations share a runtime; manifest checks include generated assets and extension-page CSP; per-origin registration has acknowledgement and page checks. | `scripts/check-manifest.mjs`; `tests/browser/extension.spec.mjs`; `tests/unit/registerSite.test.ts` |
| JP-02 | `fill/resolver.ts` returns successful classification when optional cache persistence fails and logs that failure separately. | `tests/unit/resolver.test.ts` |
| JP-03 | `storage/profileStore.ts` uses named snapshots and revision conflicts; `coordination.ts` serializes container mutations across extension contexts. | `profiles.test.ts`; `tests/browser/profile-editing.spec.mjs` |
| JP-04 | Options keeps per-profile draft/base state; upload/import callbacks patch the original draft and check intervening changes. Rename does not discard dirty content. | `editorState.test.tsx`; `importProfile.test.ts`; `tests/browser/profile-editing.spec.mjs` |
| JP-05 | Settings, answers, and tracker use edited-field mutations/conflicts; collection subscriptions refresh dependent views and surface failures. | `settingsStore.test.ts`; `answers.test.ts`; `editorState.test.tsx`; profile browser fixtures |
| JP-06 | `useFillPlan.ts` retains manual overlays by field/document meaning and only invalidates relevant classification inputs. | `useFillPlan.test.tsx` |
| JP-07 | Protocol, `FillRuns`, background routing, and runtime bind runs to document IDs, await results, cancel stale work, and expire lost requests. | `fillRuns.test.ts`; `background.test.ts`; `contentRuntime.test.ts`; `tests/browser/fill-workflow.spec.mjs` |
| JP-08 | `interpretAnswer.ts` checks supported US authorization/sponsorship wording and polarity; ambiguity leaves the field manual. | `interpretAnswer.test.ts`; `valueFor.test.ts` |
| JP-09 | Canonical application identity and expiring persisted attempt evidence replace company/title and tab-only pairing. Job/answer writes consume evidence atomically with explicit outcomes. | `submissions.test.ts`; `trackerDetect.test.ts`; `tests/browser/fill-workflow.spec.mjs` |
| JP-10 | Captured/generated answers start application-only; legacy cross-application reuse requires confirmation. Runtime records actual attached-file provenance rather than trusting the default filename. | `answers.test.ts`; `submissions.test.ts`; `contentRuntime.test.ts` |
| JP-11 | Generation drafts have application/profile identity and persisted revisions; review operations guard completion, failure, and cleanup against newer work. | `generateReview.test.tsx`; `generationDrafts.test.ts`; `tests/browser/generation.spec.mjs` |
| JP-12 | `generation/importResult.ts` compares factual content without discarding punctuation, case, numbers, or technical tokens. | `importResult.test.ts` |
| JP-13 | `versions.ts` commits artifacts/metadata atomically; metadata-only lists and reference-aware deletion protect generated formats and all profile defaults. | `documents.test.ts`; `dbUpgrade.test.ts`; generation browser fixtures |
| JP-14 | Strict compatible backup validation, coordinated writers, durable commit/rollback recovery, raw recovery export, and deletion-safe restore revisions replace unchecked multi-store replacement. Missing historical references remain reported history. | `backupStore.test.ts`; `storageRecovery.test.ts`; `dbUpgrade.test.ts`; `tests/browser/storage-recovery.spec.mjs` |
| JP-15 | Complete resume content/order checks, DOCX XML checks, and representative long-content layout tests replace sampled fields. Lazy browser PDF paths and browser CSP also address defects exposed by actual document generation. | `renderRoundtrip.test.ts`; `documentLayout.test.ts`; `pdfOwnership.test.ts`; `tests/browser/generation.spec.mjs` |
| JP-16 | Vitest is locked to 4.1.11; clean-install checks and dependency auditing are part of CI. | `package-lock.json`; `.github/workflows/verify.yml`; `npm audit --audit-level=moderate` |
| JP-17 | Executor/listbox helpers check committed state over bounded intervals, reject disabled controls, and cancel detached/obsolete widget work. | `executor.test.ts`; `listbox.test.ts`; `contentRuntime.test.ts`; `tests/browser/fill-workflow.spec.mjs` |

Unqualified test filenames above are under `tests/unit/`; module paths are under `src/lib/` unless stated otherwise.

## Release checks — September 9, 2026

The main checkout and an isolated fresh checkout of `24fb97e` pass 341 unit tests in 43 files, 13 Chromium browser tests, TypeScript compilation, production build, and generated-manifest checks. The same full local gates pass again at final source `e8920e1`. `npm ci` reproduces the lockfile; dependency audit reports zero advisories. Native Chrome 153.0.8010.37 packages the extension successfully (exit 0). Runtime browser tests use Chrome for Testing 153.0.8010.12 with the actual production extension. CI independently runs the full source gates on Windows and Linux, plus all 13 browser workflows on Linux.

Browser workflows cover first-run profile import and attachment, saved/dirty/conflicting profile edits across two pages, narrow keyboard tabs, same-URL form replacement, a cross-origin frame and open shadow root, 150 ms controlled reversion, accepted/rejected custom selection, resume preview/validation/PDF-DOCX download/default selection, encrypted backup with a 1 MB synthetic attachment, and process restart from both durable journal intents. Transaction fault tests cover the additional interruption and failed-compensation boundaries. Attachment fixtures contain synthetic bytes; the generation test separately renders and validates actual document formats.

Public pre-submit checks used Chrome for Testing 153.0.8010.12 in an isolated profile. [Raw observations](qa/2026-09-09/public-portals.json) preserve the initial results; the [Greenhouse hydration diagnostic](qa/2026-09-09/greenhouse-hydration.json) preserves the failure and successful retry. No real application was submitted.

| Public form | Observed result |
|---|---|
| [System / Greenhouse](https://job-boards.greenhouse.io/system/jobs/6014153004) | 30 fields discovered. Initial name fill correctly reported failure when hydration reset the same input. After 2.5 seconds and a rescan, fill held through an additional 1.1-second observation; clear passed. |
| [Slate / Lever](https://jobs.lever.co/slate/557fe4ab-d292-4069-8c63-36752f3da91d/apply) | 23 fields discovered; synthetic name fill and clear passed. |
| [Sift Stack / Ashby](https://jobs.ashbyhq.com/siftstack/be082df3-225c-4269-a159-bdb362b21c8e/application) | 11 fields discovered; synthetic name fill and clear passed after opening Application. |

These are limited, observed interactions on those forms. They do not qualify every control, employer parser, first-paint fill, or future portal revision.

Representative two-page PDF stress output passes full text/order and margin geometry checks. Both rendered pages were inspected after correcting oversized unbreakable entries, overlapping title/date rows, and overlong URLs. Every URL character is retained without added hyphens. Evidence: [page 1](qa/2026-09-09/resume-stress-1.png), [page 2](qa/2026-09-09/resume-stress-2.png). DOCX checks inspect content/order and Letter/paragraph flow structure.

Workbench screenshots were reviewed at 320/360/400 px. [Fill at 320 px](qa/2026-09-09/workbench-320.png) and the [version library at 320 px](qa/2026-09-09/version-library-320.png) retain accessible actions and context without horizontal overflow. Real browser tests exercise arrow/Home/End tab navigation and profile conflict recovery. Ten additional [state captures and observations](qa/2026-09-09/ui/ACCEPTANCE.md) cover empty, loading, failure and conflict states, including actual 200% browser zoom on profile recovery. All visible inputs have labels and controls/messages fit horizontally. Loading alone uses an explicitly delayed storage-read test adapter. Final minor findings were corrected: rejected imports/provider failures announce through alert roles, and settings conflicts omit internal exception class names.

## Startup cost

Five cold empty profiles per artifact measured time from panel navigation to visible Fill navigation. The before artifact's application source matches `6df0f8f`; the after artifact is `24fb97e`. JavaScript bytes are uncompressed bytes of observed module requests. Extension resources did not populate Performance Resource Timing reliably, so the diagnostic uses browser request events and rejects an empty measurement.

| Measurement | Before | After |
|---|---:|---:|
| Startup JavaScript | 1,896,289 B | 370,383 B |
| Median Fill navigation readiness | 183 ms | 106 ms |
| Total local build output | 4,212,645 B | 3,934,586 B |

The startup JavaScript reduction is about 80%. Timing is a local observation, not a latency guarantee. PDF/DOCX renderers and PDF extraction load only when requested. [Raw measurements and methodology](qa/2026-09-09/startup.json); reproduce with `node scripts/measure-startup.mjs <build-directory>`.

## Explicit qualification limits

- Edge is not installed here. Native Chrome packaging and Chrome for Testing runtime checks pass; a native Edge runtime pass is not claimed.
- No LibreOffice/office renderer is installed, so DOCX visual pagination remains unverified. XML content and structure pass; PDF pages were visually inspected. Accented Latin content is exercised; arbitrary Unicode font coverage and every ATS parser are not qualified.
- No live provider credentials or configured model servers were supplied for this qualification. Twenty-three deterministic provider transport tests cover malformed/truncated/refused output, streaming completion/failure, and cleanup; they do not establish current account/model/CORS behavior.
- Site permission acceptance/denial, registration failures, changed-page ownership, acknowledgements, and timeouts pass deterministic tests. The native browser permission prompt itself was not operated. Physical screen-reader qualification remains separate from semantic/keyboard checks. Actual 200% browser zoom was exercised on profile conflict recovery; every tab and zoom factor was not exercised.
- DOM verification requires 250 ms of stable observed state within a bounded wait. A website can change after that window. When a form resets during loading, wait for it to settle, rescan, and review before retrying.

These environment and capability limits are recorded under the user's authorization to make implementation decisions. They are not unresolved defects silently marked as tested.

## Integration and follow-up

Independent reviewers inspected storage/generation, fill/application evidence, and UI ownership, then cross-reviewed the other boundaries. Integration fixes include real-browser PDF API selection and CSP, late-panel field replay, deletion/restore revision reuse, precise attachment provenance, detached dropdown cancellation, and old-port callback isolation. Exact staged diffs and whitespace checks were inspected before the verified checkpoint was pushed.

Integrate the tested Thermo history with the [fast-forward procedure](OVERHAUL_PLAN.md#thermo--master-procedure). Preserve Thermo. Verify the final documentation tip's CI and remote `master` agreement; do not rewrite history. Platform/provider checks above can be repeated when those environments are available, using synthetic data and stopping before application submission.

Existing capability limits remain explicit: heuristic-only sites, unsupported specialized widgets, manual fallback for uncorrelated confirmations, bounded DOM verification, and no universal ATS-parser guarantee. The architecture and recovery contracts are documented in [ARCHITECTURE.md](../ARCHITECTURE.md); usage and backup instructions are in [README.md](../README.md).
