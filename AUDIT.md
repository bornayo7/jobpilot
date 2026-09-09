# Code audit — September 6, 2026

> Historical report, with commit hashes corrected against repository history on September 9, 2026. Results and limitations below describe the September 6 audit. The overhaul supersedes those limitations where explicitly verified in the [current release evidence](docs/REVIEW_RESOLUTION.md); the [baseline review](docs/CODEBASE_REVIEW.md#historical-provenance-correction) retains the old-to-actual hash mapping.

Reviewed the application source, entrypoints, configuration, README, and all existing unit tests from baseline `faf1890`. Implemented the following thirteen findings in separate commits, each pushed to `bornayo7/jobpilot` on `master`. This is a code and automated-test audit; no real job applications were submitted, paid provider calls made, or live Chrome/ATS flows exercised.

## Implemented findings

| Commit | Failure scenario | Change and regression coverage |
|---|---|---|
| `b0c3699` | Automatic rules overrode saved manual mappings. | Apply user corrections before adapters and heuristics; test overrides and explicit unknown mappings. |
| `7f96b07` | An old asynchronous plan could replace a newer plan or use the wrong profile's resume. | Bind resume lookup to profile, invalidate obsolete requests and missing frames, clear stale rows, disable Fill while resolving; test stale success/failure and disappearing frames. |
| `0ebe7b8` | pdf.js could transfer and detach the PDF bytes needed for saving. | Validate a copy and always destroy the PDF task; simulate transferable-buffer ownership and failure cleanup. |
| `d1de061` | Edited drafts or changed job/profile context retained obsolete approval state. | Invalidate previews/reviews and reject stale async completions; test draft edits and context changes. Invalidate resume-import validation after edits too. |
| `9771d03` | A malformed backup or late storage failure could partially erase stored data. | Validate all stores and decode files before writes, replace IndexedDB in one transaction, compensate if local storage fails, and include legacy profiles during export; test round-trip, malformed inputs, transaction abort and compensation. |
| `4a3fdca` | The installed happy-dom test dependency had critical/high security advisories. | Update happy-dom to 20.14.0 with lockfile; full regression suite and npm audit pass. |
| `9009d0d` | Discovery/execution could target disabled, read-only, password or incompatible controls. | Respect fieldset/legend and disabled-option semantics, reject unsafe action/control combinations, and recheck at execution; DOM regressions cover these paths. |
| `0a0e328` | Dropdown selection could choose an unrelated/hidden option, or match “No” to “Now”. | Scope by ARIA associations, filter unavailable options, use whole-token matching; test unrelated dropdowns, hidden/disabled options and missing targets. |
| `387db76` | Unrelated JSON or a future schema could validate as an empty/current profile. | Require a recognized profile section and reject unsupported future versions; import regressions added. |
| `a576bcb` | Navigation, reconnects and rescans retained old fields or job descriptions. | Reset panel state on navigation, guard replaced ports, track JD frame ownership and clear JD before extraction; reducer regressions cover these transitions. |
| `6851cd0` | Unrecognized fields appeared without a way to correct/fill them. | Make unmatched rows editable and promote corrections into the review plan; test manual value/kind edits and saved correction. |
| `2bd4a25` | Concurrent mapping reads/writes could lose new corrections or classifier results. | Serialize read-modify-write operations using Web Locks, with a same-context fallback where unavailable; test concurrent writes and lookup/write overlap. |
| `663ddb3` | Cache eviction removed supposedly permanent manual corrections. | Apply the 2,000-entry eviction limit to model entries only; test correction survival after overflow. |

## Verification

- `npm test`: **170 tests passed across 27 files**, up from 135 tests across 21 files.
- `npm run compile`: passed.
- `npm run build`: production Chrome MV3 extension built, including its pdf.js worker asset.
- `npm audit`: zero reported vulnerabilities at audit time.
- Focused regression tests and exact diffs were checked before each fix was committed.
- On this machine, run commands from `C:\Users\yashb\Desktop\Github\jobpilot`. The OneDrive alias caused Vitest module-resolution failures; the real path passes.

The build still reports large chunks: total output is about 4.19 MB, including a 1.62 MB side-panel chunk and both pdf.js variants. PDF round-trip tests emit a standard-font-data warning while passing. Intentional provider-failure and corrupt-profile tests also log their expected errors.

## Limits and next improvements

1. **Prove the first application flow in Chrome.** Start with Greenhouse, Lever and Ashby. Check the initial resume attachment, Yes/No questions, SPA navigation, iframe changes, and refreshing a posting. Add browser fixtures for repeatable regression checks before extending ATS coverage. No automatic submission is needed.
2. **Save a draft per application.** Persist the posting, selected profile/document versions, and edited answers together. Add clear resume filename/profile/job context at final review and a way to continue a draft after reopening Chrome.
3. **Add repeated work/education sections and split-date widgets.** These are likely to save more manual entry than another model provider. Scope Workday/iCIMS/SmartRecruiters adapters against observed forms; their current adapters remain stubs.
4. **Reduce document-loading cost.** Keep document metadata separate from binary blobs and load rendering libraries only when needed. The current build size and `listDocuments` reading blob bytes justify measuring panel startup and library growth first.
5. **Strengthen persistence under concurrent editing.** Extend serialization/version checks beyond the mapping cache to profile/settings editors and tracker updates. Backup compensation handles tested failures, but IndexedDB and chrome.storage cannot form one atomic transaction: a browser crash between stores, rollback failure, or concurrent editing during restore still needs a stronger recovery protocol.
6. **Expand document and provider integration validation.** Test all resume sections against representative ATS extraction and exercise configured providers with opt-in credentials. Current text checks and mocked HTTP tests do not establish live provider compatibility or complete ATS parsing.

These are prioritized follow-up proposals and validation gaps, not claims that those integrations have been tested successfully. The README was also corrected to describe the actual privacy boundary, manual-mapping precedence, test coverage and readback/document-validation limits.
