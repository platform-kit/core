## ADDED Requirements

### Requirement: A book without its text prints only its summaries

A book marked `fullText: false` SHALL offer only the summary edition, and without one it SHALL NOT be in print. The deploy's catalog and the print script SHALL refuse a print block that lists any other contents for it (full, parts or both), naming the book and the contents. The summary edition SHALL be set without drawing on the full text.

#### Scenario: a block that lists the full text

- **WHEN** a book marked `fullText: false` lists `contents: [full, summary, parts]`
- **THEN** its offers carry the summary edition alone

Verified by: `node build/print-offers.test.mjs`

#### Scenario: a block with no summary edition

- **WHEN** a book marked `fullText: false` lists only `full`, or no contents (whose default holds the text)
- **THEN** it is not in print

Verified by: `node build/print-offers.test.mjs`
