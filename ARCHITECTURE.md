# JobPilot architecture

This describes the implemented Thermo design at `e8920e1`. [REVIEW_RESOLUTION.md](docs/REVIEW_RESOLUTION.md) records its release evidence and qualification limits. Domain terms live in [CONTEXT.md](CONTEXT.md).

## Runtime boundaries

- `entrypoints/ats.content.ts` and `entrypoints/linkedin.content.ts` share `src/lib/content/runtime.ts`. Separate declarations preserve ATS origin fallback while keeping LinkedIn's narrower path valid. Dynamic per-origin access uses `registerSite.ts` and worker acknowledgements.
- `entrypoints/background.ts` routes ports, tracks current frame documents, rejects obsolete run messages, and invokes submission recording. It also owns site registration and tab/frame cleanup.
- `entrypoints/sidepanel/` provides Fill, Generate, Tracker, Answers, and Settings. `entrypoints/options/` edits profile drafts and exposes documents, import, and backup recovery.
- Content scripts discover fields, receive selected fill instructions/file payloads, and capture application evidence. Provider keys and the complete stored profile are used in extension pages, not sent to the page runtime.

## Editing and persistence

`profileStore.ts` exposes `loadProfileSnapshot`, `watchProfileSnapshot`, and `saveProfileSnapshot(base, next)`. A snapshot includes the profile ID, name, content revision, and profile. Saves target the named ID and reject a stale revision. Metadata-only rename/switch operations preserve content revisions. Options owns detached drafts and resolves external content conflicts explicitly; drafts are kept while the editor is open, not included in backups until saved.

`settingsStore.ts` exposes snapshots and `patchSettings(patch, base?)`. Only edited paths participate in conflict detection, so an unrelated tone/settings update can merge. Answer and tracker stores similarly expose field patches with either a revision or edited-field base. Collection notifications prompt UI refresh; revision checks establish integrity even if a notification is delayed.

All ordinary storage operations use `coordination.ts` through `withStorageRead` or `withStorageWrite`. A shared Web Lock serializes extension contexts. The in-process Promise fallback exists for environments without Web Locks; it is not a substitute for cross-context browser locking. Callbacks own the lock and must use their provided raw database handle rather than nest another coordinated operation.

`db.ts` owns IndexedDB schema upgrades and raw connections. Version 2 adds document metadata, recovery journals, submission attempts, and generation drafts, plus application/attempt indexes. Tests model storage cloning and IndexedDB transactions instead of sharing object references across fake reads.

## Recoverable cross-store changes

IndexedDB and Chrome storage have separate commit boundaries. `replaceAcrossStores` hides that coordination from backup restore and reference-aware deletion:

1. Under the common lock, one IDB transaction stores previous affected rows and local values in a journal, applies new IDB rows, and records commit intent.
2. Apply the intended local values, then remove the journal.
3. If local writing fails, persist rollback intent before restoring previous IDB/local values.
4. Before any normal read/write, replay the last durable journal intent. If replay fails, retain the journal and raise `StorageRecoveryError`.

Failure before durable rollback intent leaves commit intent authoritative. Failure during final journal cleanup also requires recovery even though data may already be committed. A successful rollback is reported only after it finishes. Collection signals are advisory and cannot turn an already committed write into a reported data-write failure.

`revisions.ts` retains a revision floor before deletions and restores, outside exported payloads. Restored profile, settings, answer, tracker, and draft revisions exceed current, incoming, and removed bases. Deleting an ID and restoring an older backup cannot make an old editor revision valid again.

`backupStore.ts` validates before replacement, exports raw unsupported profiles without disguising them as blank data, preserves and reports missing historical targets, derives metadata from restored artifacts, and clears transient submit attempts. Browser permissions, unsaved editor drafts, recovery journals, and the revision floor are not portable backup data.

## Fill and application evidence

`discovery.ts` assigns identities to actual DOM elements, including open shadow roots; copied attributes do not confer identity. `resolver.ts` classifies fields and materializes proposed values. Manual corrections override automatic tiers. Optional mapping-cache failure cannot invalidate a valid model classification.

`useFillPlan` owns manual review overlays separately from classification. `FillRuns` owns request IDs, document identity, cancellation, and terminal outcomes. The content runtime invalidates obsolete documents and runs. The executor rejects unavailable controls and uses bounded control-specific settling checks; this is observed commitment, not a guarantee against arbitrary later site mutations.

`interpretAnswer.ts` handles supported authorization/sponsorship wording and polarity for stored US work facts; unsupported or compound questions return no automatic answer. Sensitive proposals remain review-gated.

`applicationId.ts` uses recognized ATS posting IDs and conservative URL fallbacks. `SubmissionTracker` persists attempt evidence with a 20-minute expiry. A transaction consumes matching confirmation evidence and writes the tracker record and captured answers together. Duplicate/ignored/failure results are explicit, and failed recording keeps evidence for retry. Resume provenance is tied to a successful attachment and the retained File object; matching a filename alone does not establish its generated version.

Captured/generated answers are scoped to their application. Cross-application ranking requires both a reusable flag and explicit reuse confirmation. Historical rows without that confirmation retain their text but do not silently become cross-application suggestions.

## Document generation and ownership

Prompt Studio builds external copy/paste prompts. Generation drafts are persisted with revisions under the exact application URL and profile ID; UI queues writes per draft and guards asynchronous results by operation identity.

Renderers and PDF extraction load lazily. Browser/Node rendering paths are selected by build/runtime context rather than the presence of a throwing browser export. Resume review compares meaningful bullet punctuation and quantities and validates complete extracted content/order. PDF and DOCX consume the same resume schema; validation and representative layout tests are separate from ATS-parser qualification.

Preparation produces artifacts without saving. `commitVersion` stores version metadata and all required formats in one IDB transaction. Document lists read `documentMeta`. Deleting a generated version removes its artifacts together; clearing any profile defaults uses the journal above. Historical tracker references may outlive the deleted version and remain provenance.

## Verification boundaries

`npm run check` covers TypeScript, Vitest, production bundling, and generated-manifest invariants. `tests/browser` loads the built extension in isolated Chromium profiles. CI runs Windows/Linux checks and Linux browser fixtures. Provider contract tests use controlled transports; live credentials, portal behavior, browser variants, visual layout, and final commit/CI ancestry require explicit qualification evidence.
