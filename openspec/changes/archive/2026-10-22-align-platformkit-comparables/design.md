# Design

## Context

See proposal.md for motivation. The community and network rows already appear in both overview documents. The existing `kit-principles` requirement records comparable rows, but its Circle row is older and it has no Bluesky/Mastodon row. PlatformKit already ships the `network` module and its atproto surface.

## Goals / Non-Goals

**Goals:**

- Make the `kit-principles` row contract, its overview table, and both documentation copies agree in their first three columns.
- Keep the fourth overview column as explanatory text about limitations.

**Non-Goals:**

- Add or alter runtime behavior, network protocols, user-facing UI strings, controls, or motion.
- Assert Mastodon protocol interoperability; the existing overview's comparator label is retained without extending its claims.

## Decisions

### Keep the overview rows as the requested contract

The current overview rows are treated as intentional instructions, not corrected down to the older specification. Update the `kit-principles` requirement delta to carry their exact first three columns, including the updated Circle comparator list and the separate network row. Keep the spec's top-level comparable table and both overview tables aligned with those rows when applying and archiving the delta.

**Alternative considered:** Remove the doc-only words to match the old spec. Rejected because the project's documentation rule says a row added to the overview is a proposed feature instruction, not a typo to silently remove.

### Reuse the existing documentation guard

Use `docs-check.mjs` to verify row parity and the current-change proposal recognition. Do not add a second table parser or a new test: the existing check already enforces exact equality across the spec and both overview documents.

**Alternative considered:** Add an independent comparables test. Rejected because it would duplicate the existing guard and create another source of drift.

## Risks / Trade-offs

- **The spec and two docs can drift again** → Keep the exact row contract in the requirement and run `docs-check.mjs` after the aligned edits.
- **A comparator label could be mistaken for an interoperability guarantee** → Preserve only the existing descriptive wording; add no new protocol or compatibility claims.

## Migration Plan

No data or runtime migration is required. Apply the reviewed delta, synchronize the spec's top-level table and both overview tables, run the documentation and OpenSpec checks, then archive the delta. Reverting the documentation and spec changes restores the prior state.
