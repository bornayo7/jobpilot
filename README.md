# JobPilot

A browser extension that fills in job applications from a profile you control, and helps you tailor a resume and cover letter to the posting you're currently looking at.

It is a personal tool, built for one person's job hunt. It is not on any extension store — you build it and load it unpacked.

---

## What problem it solves

Applying to jobs is the same twenty minutes over and over: retype your name, address, and work history into a slightly different form; re-answer "why do you want to work here?"; re-tailor a resume to a posting you'll read once.

JobPilot removes the repetition without removing you from the loop:

- **It fills the form, you submit it.** Nothing is ever auto-submitted. Every value lands in a review table first, and the ones that matter are flagged for you to read before anything is written to the page.
- **It writes nothing on its own.** Long-form text — resumes, cover letters, screening answers — is produced by *your* chat subscription, not by an API key burning your money in the background. See [The Prompt Studio](#the-prompt-studio) below.
- **It remembers.** Answer a screening question once and it's in a bank you can reuse, on your terms.

---

## What it does

**Autofill.** Detects the ATS you're on, discovers supported controls (including inside open shadow roots and permitted cross-origin iframes), works out what each field wants, and fills it from your profile. Reads values back immediately to check each write; a site's later asynchronous changes still need visual review.

**Prompt Studio.** Scans the job posting, then builds a complete, self-contained prompt for a tailored resume, a cover letter, a specific screening answer, or a follow-up email. You paste it into claude.ai or ChatGPT, paste the reply back, and JobPilot validates and renders it.

**ATS-safe document rendering.** Approved resumes render to PDF *and* DOCX from the same JSON. Single column, standard PDF fonts, contact details in the body, no soft hyphens. PDF validation extracts the text layer with pdf.js and checks name/email, employers, work bullets, schools, sampled skills, and basic reading order. This is a structural check, not a guarantee that every ATS will parse every section correctly.

**Answers bank.** Free-text answers are snapshotted the moment you click Submit, before navigation destroys the form. Similar questions on later applications surface them as ranked suggestions — never as autofill.

**Application tracker.** An entry is created when a confirmation page actually appears, not when you click Submit. (Trusting the click is the most common way trackers end up full of applications that never went through.) Groups by status, flags follow-ups that are due, and warns you when you're about to apply somewhere you already applied.

**Dealbreaker warnings.** Scans the posting locally — plain regex, no model — for the things you told it you care about: no visa sponsorship, citizenship or clearance requirements, a salary ceiling below your floor, or your own custom terms. You get told before you spend twenty minutes on it.

**Match gaps.** Which of your skills the posting mentions, and which recurring terms in the posting your profile lacks. Deliberately a list, not a percentage — coverage scores invite score-chasing rather than honest tailoring.

**Multiple profiles.** Keep a "SWE" profile and an "ML" profile with different bullets and a different default resume. Switching changes what every tab reads, live.

**Encrypted backup.** Everything — profiles, settings, answers, tracker, generated documents — into one passphrase-protected `.jpbak` file. AES-GCM, key derived with PBKDF2-SHA256 at 310,000 iterations, WebCrypto only.

---

## Privacy model

This is the part worth reading before you trust it with your data.

**Everything is local.** There is no JobPilot server, no account, and no telemetry. Your profile lives in `chrome.storage.local`; documents, answers, tracker entries, and generated versions live in IndexedDB on your machine.

**Your EEO answers are never sent to a model.** Gender, race, veteran status, disability status, and pronouns are filled only by deterministic tiers (per-site adapters and label rules), are stripped from every Prompt Studio prompt, and are always flagged for explicit review before being written to a page. This is enforced structurally: the model-classification tier is restricted to an allowlist of non-sensitive field kinds, and any answer outside that list is discarded rather than trusted.

**Your API keys do cheap work only.** If you configure a key, it is used for one thing: classifying form fields the deterministic tiers couldn't identify — a single batched call per form. All the expensive writing goes through the copy-paste flow to a subscription you already pay for.

**The content script is deliberately dumb.** The only code that touches a job site's DOM reports field descriptions, executes fill instructions, extracts posting text, and snapshots answers. It never sees your profile, your keys, or any model.

**Site access is opt-in beyond the majors.** The extension runs automatically on the big ATS platforms. For a company's own careers site you enable it once, per origin, with an explicit permission prompt.

---

## The Prompt Studio

The unusual design decision, and the reason there's no "Generate" button that costs money.

Small models are fine at classification ("is this field a phone number?"). They are not fine at writing a resume you'll be judged on. The strong models that *are* good at it are ones most people already pay a subscription for — and running that work through an API key means paying twice.

So JobPilot splits the two:

| Work | Where it runs | What it costs |
|---|---|---|
| Field classification, when rules fail | Your configured API key or a local model | Fractions of a cent per form |
| Resumes, cover letters, screening answers, follow-up emails | Copy-paste into your own claude.ai / ChatGPT | Nothing extra |

The prompt it builds includes the posting, your profile with EEO fields removed, the tailoring rules, a strict output format, and a writing-style guide. Work authorization and preferences, including salary and visa notes, remain in the prompt: review it before pasting into an external chat. Malformed replies are rejected with readable errors before storage.

For resumes, the review step also shows you **which bullets the model rewrote versus kept verbatim from your profile**. Rewritten bullets are where fabrication risk lives, so they're listed for you to read before you approve.

---

## How the autofill works

Saved manual corrections take precedence over every automatic stage. Other fields pass through four stages, falling through only when the preceding stage cannot identify them.

1. **Per-ATS adapter** — platform-stable keys (Greenhouse's `first_name`, Ashby's `_systemfield_email`, Workday's `data-automation-id`). Deterministic, confidence 1.0. For Greenhouse, this also prefetches the job's real question schema from the public Job Board API, so selects use the exact values the server expects.
2. **Heuristics** — normalized-label regexes plus `autocomplete` attributes. Deterministic and free.
3. **Mapping cache** — model classifications from previous forms. Cache keys deliberately exclude per-posting identifiers. Manual corrections are checked before the automatic stages and are preserved when old model entries are evicted.
4. **One batched model call** for whatever is left, restricted to the non-sensitive allowlist, and cached for next time.

Values are then materialized from your profile, matched against the field's real options where they exist (a radio group counts as one field whose options are its buttons), and presented for review. Fuzzy option matches, sensitive fields, screening questions, and anything below the confidence threshold are excluded from the bulk fill until you look at them.

---

## Supported sites

| Site | Support |
|---|---|
| Greenhouse | Adapter + Job Board API schema prefetch |
| Lever | Adapter |
| Ashby | Adapter |
| Workday, iCIMS, SmartRecruiters | Detected; heuristics only (adapters not written yet) |
| LinkedIn, Indeed | Detected; heuristics only, by design — unstable DOMs and ToS-sensitive |
| Any company careers site | Enable per-origin from the Fill tab |

---

## Install and run

Requires **Node 22 or newer** (a WXT requirement).

```bash
npm install
```

Development, with hot reload and a browser launched for you:

```bash
npm run dev
```

Production build — output lands in `.output/chrome-mv3/`:

```bash
npm run build
```

To load a production build by hand: open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select `.output/chrome-mv3`.

Edge is supported via `npm run dev:edge`. `npm run zip` packages a build for distribution.

### First run

1. Click the toolbar icon (or press **Alt+J**) to open the side panel.
2. Open the **Settings** tab → **Open profile editor**, or right-click the icon → Options.
3. Fastest way to fill the profile: the **Import from your existing resume** card. Copy the prompt, paste it into claude.ai with your resume text under it, paste the JSON reply back.
4. Upload your resume in **Documents** and mark one as the default — that's what gets attached to file fields.
5. Optionally add an API key in Settings. Without one, JobPilot still runs on adapters, heuristics, and the cache; you just lose the fallback classifier.

---

## Project layout

```
entrypoints/
  ats.content.ts        Content script — the only code that touches job-site DOMs
  background.ts         Service worker; pure event router between panel and frames
  sidepanel/            The main UI (Fill · Generate · Tracker · Answers · Settings)
  options/              Profile editor, document store, import, backup
src/
  components/           Side-panel tabs and options-page cards
  hooks/                Background port connection; fill-plan resolution
src/lib/
  fill/                 Discovery, the four-stage resolver, executor, DOM helpers
    adapters/           Per-ATS classification and API prefetch
  generation/           PDF and DOCX rendering, paste-back import, ATS validation
  prompts/promptStudio/ Prompt builders and the writing-style guide
  providers/            Anthropic, OpenAI-compatible, Ollama, LM Studio, SSE parsing
  memory/               Answers bank, dealbreakers, match gaps
  tracker/              Confirmation detection and the application store
  storage/              chrome.storage and IndexedDB layers
  schema/               Zod schemas, field-kind vocabulary, migrations
tests/unit/             Vitest suite
```

---

## Development

```bash
npm test        # Vitest regression suite
npm run compile # tsc --noEmit
npm run build   # production build
```

TypeScript runs in `strict` mode with `noUncheckedIndexedAccess`. Tests cover pure logic, document round-trips, React state transitions, DOM discovery/execution in happy-dom, and backup transactions in fake-indexeddb. Chrome integration and real postings still need browser testing. See [AUDIT.md](AUDIT.md) for the verified findings and prioritized follow-up work.

---

## Known limits

Honest list of what isn't done:

- **Never verified against a live application portal.** The code has been read carefully and unit-tested; that is not the same as having submitted a real application through it. Treat the first few runs as a test, with the console open.
- No adapters yet for Workday, iCIMS, or SmartRecruiters — they fall back to heuristics.
- Multi-step application wizards aren't advanced automatically.
- Split month/year date widgets (`setDate`) aren't implemented.
- Chrome's built-in Prompt API is stubbed out, not wired up.
- The document store is shared between uploaded resumes and generated output, so the Documents list shows both.

---

## Status

Personal project under development; live-portal operation remains unverified. There is no license file, which means default copyright applies — ask before reusing it.
