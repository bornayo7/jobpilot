# JobPilot overhaul and Thermo integration plan

Prepared September 9, 2026 after the [full codebase review](CODEBASE_REVIEW.md). **Proposed, not implemented.** Source baseline: `Thermo` at `c73bd2c`; `master` at `2315bdd`.

## Outcome

A loadable extension whose reviewed form values stay attached to the correct application, whose edits survive asynchronous work, whose documents and backups recover predictably, and whose UI reports what actually completed. Retain the existing local-first architecture, React/WXT stack, user-controlled submission and subscription copy/paste writing workflow.

“Everything works perfectly” becomes explicit acceptance evidence below. Passing tests alone is insufficient: today's build passes 175 tests but Chrome refuses to load it. No claim will be made for a portal, provider or browser that was not exercised.

## Architectural approach

Keep Thermo's useful simplifications. Do not replace the extension framework or introduce a generic state/event framework. Deepen the modules whose callers currently have to coordinate too many facts.

| Module | Proposed interface and invariants | Implementation hidden at the seam |
|---|---|---|
| Profile/settings editing | Read an identity/revision snapshot; patch a named record; save or return a conflict; discard a draft. An active-profile switch never changes the target of an existing save. | Chrome storage coordination, validation, metadata notifications, dirty/base state and conflict detection. |
| Fill session | Observe current form state; edit reviewed values; execute one run. Only the originating document can execute that run or supply its results. | Relevant-input comparison, manual overlays, file reads, port request IDs, acknowledgements, timeouts, cancellation and progress. |
| Answer interpretation | Convert a supported question and profile fact into a proposed answer, or return an explicit ambiguity. | Positive/negative meaning, jurisdiction, available options and sensitive review policy. |
| Application recording | Record an attempt and evaluate confirmation evidence; return recorded, ignored, duplicate or failed. | Posting identity, evidence correlation, restart recovery, transactional job/answer writes and provenance. |
| Document lifecycle | Review a context-bound draft; prepare/validate formats; commit a version; remove a referenced document safely. | Rendering, preview disposal, atomic artifacts, reference policy, metadata indexes and stale completion rejection. |
| Backup recovery | Inspect/validate a backup; restore under exclusive coordination; recover before readers/writers resume. | Compatibility checks, cross-store durable journal, idempotent recovery and user-visible recovery state. |

Pure interpretation and comparison modules need no extra adapter. IndexedDB behavior is exercised with fake-indexeddb plus real-browser integration. Storage and ports need clone-faithful/event-order-faithful test adapters because browser behavior varies there. External provider transports are mocked for deterministic contracts, then qualified separately when configured. Do not add a seam that has no actual alternative or meaningful test adapter.

Example: `saveProfile(profile)` currently makes callers know which profile will be active after a wait. A proposed `saveProfile({ id, baseRevision, patch })` hides that timing problem and returns a conflict instead of guessing. That is the useful simplification: move responsibility into the module that can enforce it, rather than adding more watchers to every caller.

## Ordered implementation milestones

Each milestone gets focused regression coverage, typecheck, the full regression suite, a build where relevant, exact diff inspection, and a focused commit pushed to **Thermo**. Keep each verified milestone reviewable. A failing gate is repaired before moving on; it is not hidden by changing the test expectation to the broken behavior.

### 1. Establish a loadable, reproducible baseline

Addresses JP-01, JP-02, JP-16.

- Share the content runtime behind two WXT declarations: existing ten ATS patterns with origin fallback, LinkedIn `/jobs/*` without it. Preserve `content-scripts/ats.js` or update runtime site registration deliberately so generic sites still load the correct asset. Avoid duplicate runtime initialization.
- Add a generated-manifest smoke check: path/fallback compatibility, expected permissions, entrypoint files and dynamic-registration asset references. Test the produced artifact rather than only a copied source constant.
- Repair cache-failure handling without redesigning the entire resolver. A valid model result remains usable after an optional cache write fails.
- Upgrade Vitest to a supported patched release after checking WXT plugin compatibility. The advisory identifies 4.1.11 and 5.0.0 as fixed lines; select and lock a version after the compatibility check, not through `npm audit fix --force`.
- Add one reproducible verification command and GitHub Actions for clean install, typecheck, tests, build and manifest checks on Windows and Linux. Browser acceptance can use a dedicated supported Chromium runner.

**Pass gate:** clean install reproduces checks; actual Chrome loads and packs the production extension; ATS fallback and narrow LinkedIn access both work; generic site registration still works; the cache-failure regression passes; no unresolved dependency advisories without a documented, evaluated exception. Packaging is necessary but does not prove the UI/port workflow.

### 2. Make edits belong to explicit records

Addresses JP-03, JP-04, JP-05 and collection freshness.

- Add profile identity and revision to read/watch/save contracts. Serialize profile container mutations across extension contexts; version the container compatibly. Preserve existing profiles and default choices during migration.
- Keep saved snapshots and editable drafts separate. Metadata events do not erase dirty content; a conflicting content update produces an actionable conflict instead of silent overwrite. Upload/import completions patch only their originating profile and revision.
- Save settings by edited fields. Keep Generate tone and unrelated Settings changes independent. Use field patches for answer text/reuse and tracker notes/status; reject stale conflicting changes where merging would be ambiguous.
- Make profile, settings, answers, tracker and document summaries refresh across relevant surfaces. Report load/save failures with retry, and preserve the draft on failure.
- Correct the storage test adapter to structured-clone values at the seam. Add tests that would fail with lost writes, rather than relying on shared-object behavior in the fake browser.

**Pass gate:** concurrent profile creation preserves both new profiles; save after a switch cannot write into the new active profile; edit → rename retains content; delayed upload cannot erase newer edits; tone → unrelated settings save retains both; answer edit → reuse click and tracker notes → status retain both changes; two real extension pages observe updates and handle conflicts.

### 3. Give each fill operation a form and lifetime

Addresses JP-06, JP-07, JP-08, JP-17.

- Bind field discovery, plan and execution messages to a document/navigation identity and a run ID. A tab/frame number alone is insufficient. Distinguish a new document from an SPA form replacement.
- Keep reviewed manual values/inclusion as an overlay on classification. Reconcile unchanged fields; invalidate only decisions whose field meaning, profile or document context actually changed. Tone and warning preferences do not reset a review.
- Await execution acknowledgements for every frame; keep Fill busy until completion or explicit failure. Cancel before dispatch if context changed during file collection, reject obsolete results, and handle lost ports/timeouts without endless busy state.
- Add bounded, control-specific committed-value checks. A clicked listbox option is not automatically verified. Preserve the existing distinction between immediate observed state and arbitrary later site changes.
- Interpret authorization and sponsorship polarity/jurisdiction before matching Yes/No. For compound, unsupported or ambiguous questions, show the reason and request manual input rather than propose a likely wrong sensitive answer.

**Pass gate:** no old instruction touches a replacement document; double-click cannot overlap runs; slow select/file workflows report completion accurately; rejected selection and deferred reversion are reported; non-US and negative authorization questions do not inherit the wrong boolean; normal native, controlled, radio, iframe and shadow-root controls pass in browser fixtures.

### 4. Record applications from correlated evidence

Addresses JP-09, JP-10 and same-application answer suggestions.

- Define a canonical posting identity using ATS requisition identifiers where available, with a conservative URL fallback. Company/title is display data, not identity.
- Snapshot the application, profile and actual selected/attached document at the attempt, rather than reading the active profile after confirmation. Persist only the minimum session evidence needed to survive service-worker restarts, with expiry and cleanup.
- Combine specific confirmation evidence with its attempt and application context. A generic phrase or employer slug cannot create an Applied record. Ambiguous/no-attempt evidence can be shown for manual recording; it does not silently become a confirmed application.
- Record tracker entry and captured answers in one IndexedDB transaction with idempotency. Return explicit duplicate/failure outcomes, preserving retryable evidence when persistence fails.
- Default newly captured answers to application-only. Promote to reusable explicitly, show origin, and conservatively flag sensitive or employer-specific text. Pass the real current application identity into ranking and refresh it on the same page.
- Existing rows do not distinguish automatic reuse from a deliberate user choice. Proposed migration: preserve their text, origin and old flag, mark reuse as needing confirmation, and pause cross-application suggestions until the user reaffirms the choice. Explain this once and allow an explicit review of multiple answers; do not silently erase historical answers or pretend provenance exists.

**Pass gate:** posting prose creates no record; another application's confirmation cannot consume an old attempt; same-title distinct requisitions both persist; concurrent/replayed confirmations create one record; worker restart preserves valid evidence without reviving expired evidence; job/answer failure leaves no partial write; sensitive answers remain scoped until deliberate promotion; legacy answer migration preserves data and requires explicit reuse review.

### 5. Make restore recoverable across interruptions

Addresses JP-14 and coordination used by milestones 2/6.

- Reuse strict migration/compatibility validation for every profile and version; validate IDs and cross-record references before replacement. Distinguish required generated-artifact membership from historical links: tracker version references and answer application references may outlive deleted records. Preserve/report those links; report dangling legacy profile defaults and offer explicit repair. Do not reject an otherwise recoverable self-exported legacy backup just because an optional/historical target is absent. Preserve a recoverable input when existing data is unsupported, rather than presenting a normal empty profile.
- Share writer coordination with ordinary saves. Validate first, then take the exclusive restore window and snapshot the current state under that coordination; avoid racing a backup snapshot with live writers.
- Use a durable restore journal with explicit phases and idempotent resume/rollback. All readers/writers detect unfinished recovery and wait or show recovery state before accessing a mixed snapshot. IndexedDB and chrome.storage still do not share a transaction; the journal provides recoverability, not magical cross-store atomicity.
- Fault-inject at every durable phase, including failure during compensation. Retain evidence and retry paths on recovery failure; do not claim rollback succeeded unless it did. Include data-schema upgrade/rollback fixtures.

**Pass gate:** malformed/future backup changes nothing; a concurrent edit cannot be silently lost during restore; a fresh browser context recovers after interruption at each phase to one consistent snapshot; failure is visible and prior data remains recoverable. Test ordinary encrypted export/import with real browser storage and large document fixtures.

### 6. Own document review, storage and deletion together

Addresses JP-11, JP-12, JP-13, JP-15.

- Use one operation identity and immutable review snapshot across resume, cover-letter and answer approval. Capture profile/application/review inputs; old completion, error and cleanup cannot mutate a newer draft. If an approved version commits before context changes, report that version without clearing the new draft.
- Render and validate outside the persistence transaction, then commit version metadata and all generated formats in one transaction. Abort leaves no orphaned files; use truthful storage/error messages.
- Centralize document removal/reference policy. Generated twins cannot be deleted independently through the upload list; a referenced default requires replacement or explicit clearing across affected profiles. Handle the cross-store update through the coordinated recovery mechanism rather than claiming one IDB transaction covers Chrome storage too.
- List metadata without loading every file's bytes. Load PDF/DOCX renderers and pdf.js only when required; keep the Node-only PDF path out of browser startup. Measure bytes and cold panel readiness before/after.
- Compare factual bullet content without erasing C++/C#/percentages/decimals. Expand PDF validation to all meaningful rendered sections and order. Verify DOCX paragraph/text content and inspect representative multi-page output, long names/URLs and Unicode behavior.

**Pass gate:** pending approval cannot clear newer work; forced metadata failure stores neither version nor twins; deletion cannot strand versions or silently remove another profile's default; C++→C# is shown as rewritten; omitted project/skill/content fails validation; representative PDF/DOCX files render and extract correctly. ATS compatibility remains qualified per tested parser/portal.

### 7. Build the application workbench UI

Depends on the state contracts above. The visual direction is a recommendation pending the requested preference response.

- Current job/employer, profile and selected resume appear together above the work. Retain Fill, Generate, Tracker, Answers and Settings; allow compact overflow navigation at narrow widths.
- Put fields needing review first. Use full-width values, explicit inclusion, and clear warnings. Move raw mapping/source identifiers behind “Correct field mapping.” Ordinary ready fields stay compact.
- Show actual execution/saving state, meaningful failures and recovery actions. Preserve draft work through tab switches and supported navigation. A sticky primary action names exactly what it will do.
- Wrap document actions, show filenames/version/source context, and distinguish generated versions from uploads. Keep Prompt Studio's scan → prompt → paste → review sequence.
- Add semantic tabs, accessible names, keyboard highlighting, focus management, announcements and reduced-motion support. Verify 320/360/400 px panels, wider options pages, keyboard-only and zoomed layouts.

Proposed tokens:

| Role | Choice |
|---|---|
| Paper | `#F7FBFC` |
| Group surface | `#EAF3F5` |
| Ink | `#18344A` |
| Primary action | `#006B76` |
| Review warning | `#8A5500` |
| Error | `#AF263C` |
| Type | Locally bundled IBM Plex Sans; 14 px body, 12 px secondary, 16 px section, 20 px job title; verify font license/contrast during implementation |
| Layout | Left aligned; context controls stack at narrow widths; one memorable element is the relationship between job, profile, resume and action |

```text
Job title / employer
Profile: SWE       Resume: Acme.pdf
---------------------------------
Fill  Generate  Tracker  More
Needs review
  Question
  [Full-width answer             ]
  [Include]  Correct field mapping
Ready to fill
  Name                       Ada…
  Email                      ada…
---------------------------------
[Fill 12 reviewed fields]  Status
```

Alternative considered: a mandatory step-by-step wizard. The recommended workbench better preserves rapid switching between editing a profile, reviewing a form and tailoring a document. Repeated decorative cards and prominent metrics would compete with the actual decisions, so neither is part of this proposal.

**Pass gate:** screenshot critique of empty, loading, ready, conflict and failure states; no clipped primary actions at tested widths; complete keyboard workflows; labels/focus/contrast checks; editing and tab switching preserve expected work; no implementation identifiers in the ordinary application flow.

### 8. Qualify the release, then integrate master

- Build a fresh artifact and load it in isolated Chrome and Edge profiles. Verify first-run setup, profile import/switch, file attachment on first fill, native/radio/custom controls, cross-origin frames, shadow roots, SPA navigation, permission allow/deny, reconnect and worker restart, generation/download, collections and backup recovery.
- Use local realistic ATS fixtures for repeatable destructive/failure tests. Exercise current Greenhouse, Lever and Ashby public forms to the pre-submit stage and record site/date/browser/results. Do not submit real applications as a test. Additional ATS adapters are scoped from observed form evidence; detection alone never becomes a support claim.
- Exercise provider request/response contracts with mock transports, cancellation and malformed responses. Qualify configured providers explicitly when access is available. Missing live credentials stay a named acceptance gap, not a fabricated pass.
- Review the final diff independently, reconcile JP-01–JP-17 and capability gaps, verify all intended files are committed, and run CI on the exact source commit being integrated. Correct README/AUDIT historical provenance and supported-feature claims.

**Pass gate:** every finding is fixed and verified or explicitly accepted with a concrete limit; deterministic release gates pass; minimum Chrome/ATS flow works; required live checks are recorded. A runtime failure blocks the merge. Merely unexplored feature expansion stays out of the supported feature claims.

## Thermo → master procedure

The branch already exists as **`Thermo`**, not `thermo`. It has no upstream remote branch at the reviewed baseline. No cherry-pick, branch recreation, rebase, conflict resolution or history rewrite is currently necessary. GitHub authentication works and master reports no branch protection; recheck rules before integration.

1. Keep implementation on `Thermo`. Commit only reviewed files and push verified milestones with `git push -u origin Thermo` for its first publication and `git push origin Thermo` thereafter. The planning documentation may be checkpointed there before implementation; that is not master integration.
2. At final integration, fetch again and check the clean working tree, remote state, exact tested commit and ancestry. If master advanced, merge `origin/master` into Thermo, inspect both intents for each conflicting hunk, resolve without discarding either feature, rerun all affected checks and final release gates, then push Thermo again. Never force-push to solve divergence.
3. When `master` is an ancestor of the verified Thermo tip, use:

```powershell
git fetch origin
git switch master
git merge --ff-only origin/master
git merge --ff-only Thermo
git push origin master
git fetch origin
git rev-parse master Thermo origin/master
git status --short --branch
```

The three commit IDs must agree after the push. A fast-forward preserves all existing Thermo commits and the new work; it simply moves master to the tested history. If ancestry has changed, `--ff-only` stops instead of inventing a merge result. See the [official Git explanation](https://git-scm.com/docs/git-merge#Documentation/git-merge.txt---ff-only).

4. Verify remote CI against the published source commit. Keep Thermo until the user asks for branch cleanup. If authentication, remote rules or a new competing push blocks integration, preserve the verified commits and report that exact blocker.

## Decisions to settle before source implementation

Recommended package: preserve the current local-first/copy-paste product, adopt the workbench UI, capture answers as application-only until explicitly promoted (with one-time review of legacy reuse choices), keep ambiguous confirmations out of Applied, and implement all eight stages on Thermo before master integration. Treat persistent per-application drafts as part of the application module where needed for recovery; broader automation and additional ATS coverage require observed fixtures.

The user's instruction asks for the reviewed plan first. Source implementation also requires shared understanding under the invoked [grilling skill](C:/Users/yashb/.codex/skills/grilling/SKILL.md): “Do not act on it until the user confirms you have reached a shared understanding.” The supplied AGENTS instructions separately require double-confirmation before source edits. Routine verified documentation checkpoints are already pre-authorized by the supplied GitHub workflow.

The teaching mission and visual preference were requested asynchronously. If unanswered, the workbench remains a recommendation and teaching should explain the architecture/verification decisions in this plan. Do not create a learning record claiming the user has mastered something merely because it was explained. No new architectural ADR is marked accepted until the plan's substantive choices are confirmed.

## Skills used

Ran all three requested `npx skills use` commands and read their full outputs plus referenced supporting formats. `grill-with-docs` invokes the installed grilling and domain-modeling skills; those were read. Thermo review, codebase-design, resolving-merge-conflicts and the skill installer were also read.

The downloaded grill-with-docs, frontend-design and teach files match the already installed copies after normalizing line endings. No requested skill is missing and no local customization was overwritten. Complete command logs are in `%TEMP%/jobpilot-{grill-with-docs,frontend-design,teach}-skill.txt`. Teaching will stay tied to the confirmed project mission rather than filling the repository with unrelated lessons.
