# Application ownership and recovery

Status: accepted, September 9, 2026. Yash approved the reviewed overhaul and implementation decisions.

## Decision

Retain WXT/React, local storage and the copy/paste document workflow. Make profile edits, form execution, submission evidence and generated drafts carry explicit record and operation identities. Put persistence coordination and recoverable cross-store changes behind storage modules. Captured answers start scoped to their application; reuse requires a deliberate choice.

## Context

The full review found working-tree simplifications worth retaining, but active-profile reads, tab/frame-only routing, whole-record writes and independent artifact persistence could associate valid data with the wrong work. The existing tests missed the invalid production manifest and browser cloning/event behavior. See `../CODEBASE_REVIEW.md`, JP-01–JP-17.

## Alternatives

- Replacing the framework or introducing a general event framework adds migration risk without establishing these invariants.
- Locks alone serialize stale writes but cannot detect them; record revisions and field patches are also required.
- A single IndexedDB transaction cannot cover Chrome storage. A durable journal and shared coordination provide recoverability across that boundary.
- Company/title deduplication loses distinct requisitions. Confirmation text without matching attempt evidence can create false Applied records.
- Automatically reusing legacy answers invents permission that their stored provenance cannot establish. Preserve the text and require reuse review.
- A mandatory wizard interrupts repeated movement among profile, form and document work. The approved workbench keeps job, profile and resume context visible.

## Consequences

Storage failures remain actionable and preserve drafts. Stale operations cannot clear newer work. Generated formats commit together. Historical references may survive deletion and are reported instead of discarded. Deterministic browser and failure tests supplement unit tests; live support claims are limited to exercised environments. Work is verified and pushed on Thermo before a tested fast-forward into master.
