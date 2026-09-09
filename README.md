# JobPilot

JobPilot is a personal Chromium extension for reviewing and filling job applications, tailoring documents through your own chat subscription, and keeping application history. You review the proposed values and submit the application yourself.

The Thermo overhaul addresses all seventeen review findings. The [release evidence](docs/REVIEW_RESOLUTION.md) records 341 unit tests, 13 browser workflows, Windows/Linux CI, public form checks, and concrete qualification limits.

## Install

Use Node.js 24 and npm, matching CI. From a checkout:

```bash
npm ci
npm run build
npm run check:manifest
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `.output/chrome-mv3`. Click the JobPilot toolbar icon, or use **Alt+J**, to open its side panel. Reload the extension after rebuilding; reload an already open application page to load the new content script.

For development, `npm run dev` starts WXT. `npm run dev:edge` selects Edge; that command is available independently of the browser qualification recorded for a release. `npm run zip` packages a build. The project is loaded unpacked rather than installed from an extension store.

## Set up a profile

1. Open **Settings → Open profile editor**.
2. Enter your facts, or use **Import from your existing resume** to build a prompt and review the returned profile data.
3. Upload a resume in **Documents** and choose its default, then **Save profile**.
4. Optionally configure a field-mapping provider in Settings. Rules and saved mappings still work without a provider key. **Send test prompt** makes a real request to the selected mapping provider.

Each profile has its own open editor draft. Switching or renaming a profile keeps that draft. Saving checks the original profile and its revision; a competing edit produces a conflict with **Export draft** and **Use saved profile** actions. Profile drafts are unsaved until you press Save: save or export before closing the editor. The editor warns before leaving with dirty drafts.

## Use it on an application

**Fill** discovers supported controls, including open shadow roots and permitted frames. Saved manual mappings take precedence, followed by Greenhouse/Lever/Ashby adapters, label rules, cached classifications, and an optional model fallback. Greenhouse can also fetch its public question schema.

Review the values and inclusion controls. Sensitive answers, ambiguous questions, and fuzzy matches require attention. Authorization and sponsorship interpretation supports limited wording for the stored US work facts; unsupported wording remains manual. **Fill reviewed fields** stays busy until the run finishes or fails. Navigation, document replacement, lost connections, and timeouts invalidate obsolete runs. Readback checks observe committed values over a bounded interval; inspect the final form because a site can still change it later.

**Generate** scans the posting, builds a prompt for a resume, cover letter, or screening answer, and accepts your pasted reply. Copy the prompt into your chosen external chat, then validate and review its response. Resume review shows changed bullets and a PDF preview before approval. An approved resume saves its PDF, DOCX, and version record together. Cover letters save as PDF. Generation drafts persist by application URL and profile; watch their save status before closing the panel. A result from an older context cannot clear newer pasted work.

**Tracker** records a submission only when specific confirmation evidence matches a recent attempt for the same application. Attempts expire after 20 minutes. Unsupported confirmation flows can require a manual tracker entry; a tracker record is not an employer-issued receipt. Distinct requisitions and repeated attempts keep their own identity.

**Answers** keeps captured and generated answers scoped to their application until you explicitly permit reuse. Older rows with an unconfirmed reuse flag also require review before cross-application suggestions resume. Suggestions are ranked and require selection; they are not automatically filled or submitted.

Dealbreaker warnings and skill-gap comparisons run locally against the posting. They are prompts for review, not an assessment of eligibility or a promise of selection.

## Site coverage

| Site | Implemented handling |
|---|---|
| Greenhouse | Adapter and public question-schema prefetch |
| Lever, Ashby | Dedicated adapters |
| Workday, iCIMS, SmartRecruiters | Detection and generic rules; no dedicated adapters |
| LinkedIn, Indeed | Detection and generic rules |
| Other company careers sites | **Enable on this site** requests access for that origin and reloads the page after registration succeeds |

Detection is not proof that every portal widget works. Multi-step wizards are not advanced automatically; repeated sections and split month/year widgets have no complete specialized flow. Closed shadow roots and inaccessible frames cannot be inspected. Chrome's built-in Prompt API is not an available configured provider. Live-site and browser qualification must be read from release evidence, separately from local fixtures.

## Documents and backups

The document list uses metadata rather than reading every file's bytes. Uploaded documents and generated versions have distinct ownership. Remove generated files through the version library so their formats are deleted together. If any profile uses a file as a default, deletion requires explicit clearing of those defaults. Historical tracker references remain as history after the associated version is removed.

In the profile editor's **Backup & restore** card:

1. Enter a passphrase of at least eight characters and choose **Export encrypted backup**.
2. To restore, enter the backup's passphrase and choose **Inspect backup…**.
3. Review validation results and missing-reference warnings, then choose **Replace data with this backup** to replace saved data.

A `.jpbak` includes profiles, settings **including API keys**, uploaded/generated files, versions, answers, tracker records, mappings, unmatched-field history, and saved generation drafts. It excludes unsaved profile/settings edits, browser site permissions, transient submission attempts, and internal recovery metadata. Keep the passphrase separately: it is not saved and cannot be recovered by JobPilot. Encryption uses AES-256-GCM with a PBKDF2-SHA256 key and 310,000 iterations.

Restore validates compatible records before replacing data. Unsupported future profile formats are rejected; missing historical targets are preserved and reported. Export can preserve unsupported raw current profiles for recovery, and a compatible known-good backup can replace them. A recovery export is not a promise that an older extension can interpret a newer schema.

Restore and default-clearing deletion coordinate Chrome storage with IndexedDB through a durable journal. Normal reads and writes recover an unfinished journal first. A completed database phase resumes its recorded commit; a persisted rollback phase restores its recovery copy. If recovery cannot finish, the UI reports it and keeps the journal. Restore storage access and retry loading before further edits; do not clear extension data to dismiss the error. This mechanism makes interruptions recoverable; it does not make the two storage systems one transaction.

## Data and network access

JobPilot has no application server, account, or telemetry. Saved records remain in the browser profile. Uninstalling the extension or deleting that browser profile can remove them; export backups you intend to keep.

Optional provider requests send field-mapping prompts to the configured provider. Greenhouse schema prefetch contacts its public API. Prompt Studio removes the structured EEO section from the profile before building its prompt; work authorization, preferences, and user-written text can remain. Review copied prompts before sharing them with any external chat. The content runtime receives selected field values and file payloads, not the full stored profile or provider keys; filling then places those selected values on the application page.

## Verify and develop

```bash
npm run check                  # typecheck, unit tests, production build, manifest check
npm audit --audit-level=moderate
npx playwright install chromium
npm run test:browser            # uses the existing production build
```

On Linux, use `npx playwright install --with-deps chromium` when browser system dependencies are needed. CI runs clean-install checks on Windows and Linux and the Chromium fixture suite on Linux. Browser tests use isolated synthetic applications and do not submit real applications.

Unit tests cover storage conflicts and recovery, provider transport contracts, form discovery/execution, stale UI operations, and PDF/DOCX content. Browser fixtures exercise extension loading, profiles, filling, downloads, and storage recovery. PDF text checks include all rendered resume sections; document layout tests cover representative long content. These checks do not establish compatibility with every ATS parser, arbitrary Unicode font coverage, or all live providers.

See [ARCHITECTURE.md](ARCHITECTURE.md) for module ownership, [CONTEXT.md](CONTEXT.md) for domain terminology, the [baseline review](docs/CODEBASE_REVIEW.md), and the [approved implementation and merge plan](docs/OVERHAUL_PLAN.md). Release source is `e8920e1`, including the verified `24fb97e` overhaul and final error-announcement corrections; later documentation commits preserve that implementation.
