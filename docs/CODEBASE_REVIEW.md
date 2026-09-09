# JobPilot codebase review — September 9, 2026

Status: review complete; implementation proposed. Application source has not been changed by this review.

Reviewed source: `Thermo` at `c73bd2cf97d00902f1a258cbf070ab943657b29c`. Comparison: `master` and freshly fetched `origin/master` at `2315bdd752cec4dcdcc661ffd4bc630df62bbc51`.

## Recommendation

Retain the eleven Thermo commits, repair the demonstrated resolver regression, and complete an in-place overhaul of state ownership and verification before merging. The branch improves locality: typed fill actions, exhaustive profile getters, shared review-row construction, a submission module, and smaller UI files. Those improvements do not establish correctness of the workflows they preserve.

The important remaining work is behavioral. Profile edits need explicit identity; fill runs need an originating document and completion; submissions need evidence and an application identity; document artifacts need one transaction. Splitting more files without fixing these interfaces would rearrange the same complexity.

## Coverage and evidence

Four reviewers divided and fully read all **132 authored tracked files / 11,432 lines**, including all 28 test files, application code, styles, entrypoints, configuration and documentation. All eleven branch commit messages and the complete corresponding diffs were reviewed. The generated 5,090-line lockfile was examined through its parsed dependency graph and `npm audit`, not treated as authored source. `AGENTS.md` was read separately because it is locally present but not tracked. See [REVIEW_COVERAGE.json](REVIEW_COVERAGE.json) for file ownership, counts and hashes.

Fresh baseline from the canonical Windows checkout `C:\Users\yashb\Desktop\Github\jobpilot`:

| Check | Observed result |
|---|---|
| `npm run compile` | Pass |
| `npm test` | 175 tests pass in 28 files; 5.56 seconds |
| `npm run build` | Pass; WXT 0.21.4; 4.19 MB output; 1.62 MB sidepanel chunk |
| `git diff --check master..Thermo` | Pass |
| `npm audit --json` | Two moderate development dependency entries for one advisory; zero high/critical entries |
| Chrome 153.0.8010.37 packaging of a copy of the actual build | Exit 22, no CRX; invalid fallback match path |
| Fresh Git ancestry | `origin/master...Thermo`: 0 behind, 11 ahead; no unmerged files |

Expected provider-failure and invalid-profile logs occurred in their tests. PDF round-trip tests emit a missing standard-font-data warning. There is no browser integration suite or CI workflow in this baseline.

Review probes used actual source with in-memory/fake IndexedDB, structured-cloning storage adapters, and controlled dependency failures. They establish the stated code behavior; they are not live-provider or real-portal acceptance. Storage probes were executed in memory and their harness was not retained. Retained harnesses: `C:\Users\yashb\AppData\Local\Temp\jobpilot-fill-review.cjs` (output in adjacent `.txt`) and `C:\Users\yashb\AppData\Local\Temp\jobpilot-ui-audit-f3863e4d37d443f787f4234cd2ec8a8c\ui-repro.test.tsx`. The UI probe rendered actual Settings and reproduced the lost tone. Convert each relevant scenario below into a maintained regression before fixing it.

Chrome evidence: `C:\Users\yashb\AppData\Local\Temp\jobpilot-manifest-review-140fddd08ef04cd585c27ba9df0feed0\stderr.txt`. The optional temporary-manifest split experiment was blocked by automatic approval review with only “blocked by policy”; it did not execute. No packaging success for that proposal is claimed here.

## Findings

P1 means a release-blocking installation or integrity issue. P2 means a concrete correctness or maintainability defect requiring repair in this overhaul. “Existing” means also present on master; this distinguishes it from a Thermo regression.

| ID | Priority / origin | Evidence and failure scenario | Required result |
|---|---|---|---|
| JP-01 | P1 / existing | `entrypoints/ats.content.ts:29–32` combines LinkedIn `/jobs/*` with `matchOriginAsFallback: true`. Chrome rejects the generated manifest: `The path component for scripts with 'match_origin_as_fallback' must be '*'.` | Separate LinkedIn and fallback-enabled ATS declarations, share implementation, preserve existing access scope, and validate the built manifest and actual browser loading. |
| JP-02 | P2 / **Thermo regression** | `src/lib/fill/resolver.ts:149` awaits cache persistence before returning model results. Identical source probes with a successful classification and failing cache write leave a usable row on master but an unmatched field on Thermo. | Return the valid classification even if optional caching fails; make the cache failure diagnosable without misreporting model failure. |
| JP-03 | P2 / existing | `src/lib/storage/profileStore.ts:57` saves to whichever profile is active after its asynchronous read; management at `:99` is an unlocked read/modify/write. Clone-faithful probes lost one of two concurrent profile creations and wrote a stale profile into the newly active profile. | Explicit profile identity and base revision, serialized mutations across extension contexts, clear conflict results. Watchers alone cannot provide this guarantee. |
| JP-04 | P2 / existing | `entrypoints/options/OptionsApp.tsx:33` replaces dirty drafts on any container event, including profile rename. `src/components/profile/DocumentsCard.tsx:17` applies a captured draft after an upload await. | Drafts survive metadata changes; uploads patch only the originating profile and cannot revert intervening edits. Switching profiles has explicit draft handling. |
| JP-05 | P2 / existing | `src/components/SettingsTab.tsx:29` loads once and `:42` saves the full snapshot. Generate writes tone independently at `GenerateTab.tsx:194`. Saving an unrelated setting can restore the old tone. Answer text/reuse and tracker notes/status have analogous full-record replacement races. | Field-level mutations and revision-aware drafts, live collection updates, and visible save/error states. |
| JP-06 | P2 / existing | `src/hooks/useFillPlan.ts:69` clears all plans when any settings object changes. Typing a writing tone in Generate removes manual field values/inclusion choices even though form/profile/mapping inputs are unchanged. | Classifier output and manual review edits have distinct ownership; irrelevant settings cannot erase a review. |
| JP-07 | P2 / existing | `src/components/FillTab.tsx:84` awaits file reads then dispatches without awaiting DOM execution. `protocol.ts` has no document/run identity. Navigation during reads can target the replacement frame; the button goes idle while dropdown execution continues. | One acknowledged fill run bound to the originating document, cancellation on context changes, and terminal progress/errors. |
| JP-08 | P2 / existing | `src/lib/fill/heuristics.ts` identifies an authorization/sponsorship concept, while `valueFor.ts:44–49` maps the stored boolean directly to Yes/No without polarity or jurisdiction. Probes proposed Yes to “work without sponsorship” when sponsorship is needed, and Yes to Canadian authorization using US authorization. Sensitive rows are review-gated, limiting impact. | Model meaning, polarity and jurisdiction explicitly for supported deterministic questions; leave ambiguous wording unanswered for manual review. |
| JP-09 | P2 / existing | `src/lib/tracker/detect.ts:13` treats broad text/URL matches as confirmation; `submissions.ts:46` writes even without an attempt and pairs by tab only. `store.ts:16` dedupes by company/title in a separate transaction. Ordinary posting text can create Applied records, different requisitions can collapse, concurrent confirmations can duplicate. | Submission evidence correlated to a specific application attempt; transactional idempotency by application/attempt identity; preserve real repeated applications. |
| JP-10 | P2 / existing | `src/lib/fill/captureAnswers.ts:16` captures qualifying free text without sensitivity filtering; `submissions.ts:63` saves it `reusable: true`. A disability/history explanation can reappear on another employer's form. Suggestions still require user selection; this is not automatic submission or proof of provider disclosure. | Captured answers default to application-only; explicit promotion to reusable, with sensitive content handled conservatively. Keep source application and actual profile/document provenance. |
| JP-11 | P2 / existing | `GenerateTab.tsx:176` unconditionally clears the draft after cover-letter rendering/storage. Answer save has the same behavior; resume guards stop before persistence, not after it. Old completions can erase newer work following a page/profile/paste change. | Snapshot the reviewed context; guard every completion, error and cleanup with operation identity. Older work cannot mutate the newer draft. |
| JP-12 | P2 / existing | `src/lib/generation/importResult.ts:54,65` uses a field-label normalizer for factual bullet comparison. Actual-source probe: C++ changed to C# is reported as one kept bullet and zero rewrites. | Preserve meaningful punctuation, quantities and tokens in content comparisons; only harmless formatting can compare equal. |
| JP-13 | P2 / existing | `src/lib/generation/storeVersion.ts:22` saves two blobs and version metadata separately. Injected metadata failure leaves 2 blobs and 0 versions. `documents.ts:44` also lets a generated/default file be deleted independently of referencing records. | Atomic version/artifact filing and deletion; reference-aware document removal across profiles and versions; metadata-only listing. |
| JP-14 | P2 / existing | `src/lib/storage/backupStore.ts:115` accepts profile data with `ProfileSchema` instead of the stricter compatibility validator. A future-schema restore succeeds, then loading presents a blank fallback. Raw restored data remains stored. Restore also spans IndexedDB and chrome.storage with compensation but no crash recovery or common writer coordination. | Validate and migrate all profiles before writes; reject incompatible backups unchanged. Serialize restore against writers and implement a durable, restart-tested recovery protocol. |
| JP-15 | P2 / validation gap | `src/lib/generation/validatePdf.ts:54` checks only selected fields and three skills per group. A probe missing summary, projects and a fourth skill still returns `ok`. This does not prove the renderer loses those fields. | Check all meaningful rendered content and order, inspect DOCX content, and visually inspect representative documents. Keep real ATS parsing claims separate. |
| JP-16 | P2 / verification maintenance | Lockfile contains Vitest 3.2.7. The audit now flags Vitest and its mocker under GHSA-82fw-gwwq-j7x9. This concerns development-server configuration, not a demonstrated exploit in the packaged extension. | Upgrade to a supported patched version compatible with WXT, verify plugin/types and the full suite, then re-audit. Avoid an unreviewed force upgrade. |
| JP-17 | P2 / existing | `src/lib/fill/dom/pickFromListbox.ts:30` treats clicking an option as success without confirming committed selection. A probe with no selection handler reports Austin although the trigger stays Choose. `executor.ts:70` can report a text write as verified before a timer resets it. | Distinguish an attempted action from observed committed state, use control-specific bounded settling checks, and report unverified outcomes honestly. Test with actual browser-controlled widgets. |

## UI and capability gaps included in the plan

- Collections load once or on URL change, so the current Fill view can miss newly reusable answers, and version/default indicators can become stale across surfaces. `FramePlanView` passes no current application identity to answer ranking.
- Profile import review needs an explicit destination profile and invalidation on a destination change.
- Several clipboard, save, delete and load paths lack actionable pending/error feedback. “Nothing was stored” is inaccurate after partial artifact writes.
- Main-flow field controls expose implementation identifiers and lack accessible names. Keyboard highlighting, semantic tabs, delete names, reduced motion and narrow panel layouts require acceptance checks.
- No authored source file crosses 1,000 lines; the largest authored file is 583-line sidepanel CSS. The main problem is distributed state, not file size.
- Workday/iCIMS/SmartRecruiters are detected but have no dedicated adapters. Repeated sections, split-date widgets, Chrome Prompt API, and a surfaced follow-up prompt are not complete supported flows. Preserve honest capability labels; additional site support must be driven by inspected fixtures.
- Real provider compatibility, actual Chrome/Edge flows, browser restarts, cross-origin frames and live portal operation remain unverified.

## Rejected or calibrated claims

- The cover-letter stale-completion defect predates Thermo; moving it to `storeVersion.ts` did not create it.
- `recordUnmatched` catches its storage failures, so the suggestion that an ordinary log failure clears the successful fill plan was refuted.
- A future-profile backup can display blank without deleting its raw restored profile. Do not describe that probe as destruction of raw data.
- PDF checks passing do not establish complete ATS compatibility; omitted validation checks are not proof of rendering loss.
- A clean merge and passing unit suite do not establish a usable extension. The actual Chrome rejection demonstrates the distinction.

## Historical provenance correction

`AUDIT.md` and older project-memory prose contain hashes absent from this repository. Use real Git history and this review's pinned commits. The September 6 fixes exist under these verified hashes (same subject/order):

| Historical label | Actual commit |
|---|---|
| baseline `6ba21cc` | `faf1890` |
| `4d7d721` | `b0c3699` |
| `0c88ced` | `7f96b07` |
| `efb4b16` | `0ebe7b8` |
| `dbb4bcc` | `d1de061` |
| `4665341` | `9771d03` |
| `437e46f` | `4a3fdca` |
| `c80a8d0` | `9009d0d` |
| `e4c2cf1` | `0a0e328` |
| `5b65ce5` | `387db76` |
| `33b638e` | `a576bcb` |
| `89a27b9` | `6851cd0` |
| `48aa90b` | `2bd4a25` |
| `b3983e0` | `663ddb3` |
| audit documentation `6566353` | `2315bdd` |

## Primary references

- [Chrome content-script rules](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#inject-in-to-related-frames): fallback origin matching requires wildcard paths.
- [Git merge documentation](https://git-scm.com/docs/git-merge): fast-forward-only integration updates the branch only when ancestry permits it.
- [Vitest advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9): affected versions, development-server preconditions and supported fixes.

Next: [OVERHAUL_PLAN.md](OVERHAUL_PLAN.md).
