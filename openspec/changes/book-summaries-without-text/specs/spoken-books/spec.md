## ADDED Requirements

### Requirement: A book without its text is spoken only in summary

For a book marked `fullText: false`, the spoken book SHALL record the introduction and each chapter's summary, and SHALL NOT record or plan a recording of any chapter's text.

#### Scenario: planning the recordings

- **WHEN** the spoken-book script plans the recordings of such a book
- **THEN** its jobs are the introduction and the summaries, and none is a chapter's text

Verified by: `node build/tts.mjs --book <slug> --dry` on the demo's summaries-only book
