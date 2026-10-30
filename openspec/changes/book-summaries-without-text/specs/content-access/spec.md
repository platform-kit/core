## ADDED Requirements

### Requirement: A book can publish its summaries without its text

A book marked `fullText: false` SHALL publish its title, description, cover, introduction, chapter titles and companion as any book does, subject to its access bar and chapter allowances as usual. Its chapter text SHALL NOT appear in any published file, in the server's content index, in the content rows a visitor can read, or in anything `reader-content` sends, to any reader of any class, including one who bought the book. When the book's file still holds chapter text, the build SHALL warn that the text is held and withheld. The reader SHALL open such a book in summary mode, with no full-text mode to switch to, and a chapter without a summary SHALL say so.

#### Scenario: everything the site publishes

- **WHEN** the demo is built with a book marked `fullText: false` whose chapters hold a marker sentence and whose companion holds a summary, and every published file and the server's content index are read
- **THEN** the marker appears in none of them, the summary and the chapter titles do, and the build's output warns that the book's text is held and withheld

Verified by: `node build/gated-content.test.mjs`

#### Scenario: a member asks for the text

- **WHEN** the gate is asked for such a book's text for a guest, a member, or as a cloud row
- **THEN** it returns the chapter titles alone, with no chapter text and no teaser

Verified by: `node build/gate.test.mjs`

#### Scenario: the reader

- **WHEN** a reader opens such a book
- **THEN** it shows each chapter's summary, key points and quiz, offers no full-text mode, and its cover gives the summaries' reading time

Verified by: the reader inspected on the demo's summaries-only book at 1280 px light and 390 px dark
