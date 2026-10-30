## ADDED Requirements

### Requirement: The library is one reader over four collections

The `articles`, `books`, `wiki` and `docs` modules SHALL each be a collection of markdown records under `content/`, read in one library with a lane per collection. Each collection SHALL have its own switch. A record with `published: false` SHALL never reach the site bundle, the search index, the prerender, the sitemap or the share images, while the admin SHALL still open and edit it.

#### Scenario: an unpublished record

- **WHEN** a record is marked `published: false` and the site is built
- **THEN** nothing of it is in the compiled bundle, the search rows or the sitemap

Verified by: `build/unpublished.test.mjs`

#### Scenario: every record is valid

- **WHEN** the site's content is compiled
- **THEN** every record is checked against its collection's schema, and a record that does not fit fails the build naming its field

Verified by: `build/content.test.mjs`

### Requirement: Gated text never reaches a reader who may not read it

Access rules SHALL decide who reads what by visitor class: guest, signed-in reader, buyer or member. The built site SHALL carry only titles, descriptions, free chapters and a short opening of gated text; the rest SHALL be sent by `reader-content` only after the server checks the reader's account. A static site SHALL publish no gated text at all.

#### Scenario: a guest and a member

- **WHEN** a guest and a member each ask for a members-only book
- **THEN** the guest is sent the free chapters and the opening only, and the member the whole text

Verified by: `build/gated-content.test.mjs`, `build/reader-content.test.mjs`

### Requirement: A book is read chapter by chapter, and the reader's place is kept

A book SHALL be read chapter by chapter with a contents list, next and previous, reading-time estimates and the reader's place saved. A reader SHALL be able to bookmark, highlight in colours with margin notes, search inside the book, and choose the typeface and size. A book SHALL read in full or in summary mode, and a book with `fullText: false` SHALL send its text to nobody and read in summary mode only. Each visitor class SHALL have a set number of free chapters before the paywall.

#### Scenario: one read is one read

- **WHEN** a reader reads one piece in three sittings
- **THEN** the library's figures count one read of it, not three

Verified by: `build/reads-db.test.mjs` under `platformkit test --e2e`

### Requirement: A chapter can be mastered

A book's companion SHALL carry, per chapter, its summary, key points and a quiz, and every companion chapter SHALL be a chapter of its book. Answering all but one question of a chapter's quiz right SHALL master the chapter, and mastery SHALL earn bronze, silver and gold trophies shown on the cover and in the reader's accomplishments.

#### Scenario: a companion that names another book

- **WHEN** a companion names a book the site does not host, or carries a chapter that book does not have
- **THEN** the check fails, naming the companion and the chapter

Verified by: `build/companions.test.mjs`

### Requirement: The library searches itself

The library SHALL build one search index of every published record, searched instantly in the browser by the palette, and the same rows SHALL be projected for the server's search. "Find your book" SHALL rank the books against a reader's own description of their problem and answer the three best.

#### Scenario: the palette and the server search the same rows

- **WHEN** the index is built
- **THEN** the palette's rows and the server's rows come from the same grammar, record for record

Verified by: `build/search.test.mjs`, `build/ranking.test.mjs`

### Requirement: Wiki and docs are trees

The wiki and the docs SHALL be ordered trees of folders and pages, each page with a contents rail, and each wiki page with its related pages. A site with only the docs collection on SHALL run as a documentation site, with a navigation tree that collapses on a phone.

#### Scenario: a documentation-only site

- **WHEN** the docs site is built with no backend and walked
- **THEN** every route answers, and every page has its navigation and contents rail

Verified by: `build/static-site.test.mjs`
