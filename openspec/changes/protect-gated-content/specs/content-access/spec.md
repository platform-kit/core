## Purpose

Decide who may read a record's text on the site's own pages, and guarantee that text a visitor may not read never reaches their browser.

## ADDED Requirements

### Requirement: Gated text never reaches a reader without access

A record's text SHALL be readable on the site's pages only by a reader the access rule admits: the record's access bar (`canAccess`) against the reader's class, a book's chapter allowance for that class, and a book the reader has bought, which admits them as a paying reader of that book. Text the rule does not admit a guest to SHALL NOT appear in any published file — pages, scripts, data, pre-rendered HTML, search data, share images or sitemaps — nor in content a visitor can read from the backend. Titles, descriptions, covers, chapter titles, free chapters and records with no access bar SHALL remain public.

#### Scenario: a guest scans everything the site publishes

- **WHEN** the demo is built with a members-only article and a book whose later chapters are gated, and every published file is read as a guest
- **THEN** no sentence from a gated chapter or the gated article appears in any of them, while their titles, descriptions, free chapters and chapter titles do

Verified by: `node build/gated-content.test.mjs`, which builds the demo with gated fixtures and searches every file in its output, its pre-rendered pages and its search data for each gated sentence

#### Scenario: readers of the same book

- **WHEN** a guest, a signed-in non-member, a buyer of the book and a member ask for a gated chapter of a book gated to members, whose chapter allowance lets guests read one chapter and signed-in readers three
- **THEN** the guest gets chapter one only, the signed-in reader chapters one to three, and the buyer and the member every chapter; each refusal returns no text

Verified by: `node build/reader-content.test.mjs` against the local stack, with seeded accounts for each class and a seeded purchase

#### Scenario: a request without sign-in or with a forged class

- **WHEN** a request for gated text carries no session, an expired session, or claims a class the account does not hold
- **THEN** the server answers from the account's own entitlements and returns only what that account may read

Verified by: `node build/reader-content.test.mjs`

#### Scenario: cloud content rows

- **WHEN** a guest reads the published content rows directly from the backend in cloud mode
- **THEN** gated records come back without their gated text, and an administrator's session still sees it

Verified by: `node build/reader-content.test.mjs` in cloud mode against the local stack

### Requirement: Readers with access see gated text as they do today

A reader with access SHALL see gated text in the same reader, with the same paywall, "Yours — read it now" and "Included in your membership" states as before. The page SHALL show a loading line while gated text is fetched and a plain error with a retry if it can't be fetched, and SHALL never show a paywall to a reader with access because the fetch failed.

#### Scenario: a member opens a gated chapter

- **WHEN** a signed-in member opens a gated chapter
- **THEN** "Opening this chapter…" shows until the text arrives, then the chapter reads as before

Verified by: the rendered book reader for a member, a buyer and a guest at 1280×900 and 390×844 in light and dark

#### Scenario: the fetch fails

- **WHEN** the server can't be reached while a member opens a gated chapter
- **THEN** the reader shows the error line with a retry, not the paywall

Verified by: the rendered book reader with the request blocked

### Requirement: A static site does not publish gated text

A site whose deployment shape has no backend SHALL NOT publish gated text, because nothing can check a reader's access. Its build SHALL list the gated records it left out, and the admin SHALL say on a gated record that gated content needs a backend.

#### Scenario: a static build with a gated record

- **WHEN** a static site declares a members-only article
- **THEN** the build succeeds without the article's text, names the article in its report, and the admin shows the static-site notice on it

Verified by: `node build/gated-content.test.mjs` in the static shape, and the rendered admin record editor
