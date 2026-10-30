## Tasks

- [x] `fullText` on a book (velite schema, the admin's field, the cloud entry's fields), default true
- [x] `_shared/gate.js`: `textWithheld`, `titlesOnly`, `sentText`; `publicBook` and `publicRow` publish a withheld book's chapter titles alone
- [x] `reader-content` sends a withheld book's titles alone, to any class; `build/content-json.mjs` writes its titles alone into the server's index
- [x] The build warns while a withheld book's file still holds its text
- [x] `printSpec(block, book)` keeps the summary edition alone for a withheld book; the catalog and `print.mjs` refuse other contents by name; the store's offers, art and deploy checks pass the book
- [x] `tts.mjs` plans no recording of a withheld book's chapter text
- [x] `BookReader.vue`: summary mode only, no switch, the summaries' reading time on the cover, a chapter without a summary says so
- [x] `gate.test.mjs`, `gated-content.test.mjs` (a withheld book's marker in no published file or the content index, its summary published, the warning given), `print-offers.test.mjs`
- [x] The demo's *The Long View*: a book of titles and a companion, read at 1280 px light and 390 px dark, and its spoken book planned (`tts.mjs --dry`: the introduction and three summaries)
- [x] Publishing basics, reading, books, print editions, spoken books, frontmatter, the content pipeline, the content API, FEATURES.md
- [ ] `reader-content.test.mjs` against a local stack (skipped here: no stack for it), and the admin's print table shown with the book (`PrintAdmin.vue` is mid-change in another session)
