# Tasks

## 1. Data

- [x] 1.1 `courses_list` adds:
  - access and what getting in takes;
  - the next open lesson;
  - when the reader was last active;
  - the certificate;
  - the section count.
  
  `course_state` adds the kinds of media each lesson carries (never their addresses).
  
  Verified by `courses-db.test.mjs`.

## 2. Where courses live

- [x] 2.1 Remove `courses.where`: the Courses place is registered whenever spaces and network are on; `/courses` is always its own pages; a site setting `courses.where` is refused by name. Verified by `courses.test.mjs`.
- [x] 2.2 Remove the app area's courses tab; `/app/courses` forwards to `/courses` ahead of any place claiming `/app`. Verified by `courses.test.mjs`.

## 3. The screens

- [x] 3.1 The library: Continue, in progress, finished, the catalogue; the drawn cover. Verified by rendering at 1280 and 390, light and dark, as a guest, a new reader and a reader part way through.
- [x] 3.2 The overview: cover band, sticky progress card, folding modules with their counts, lesson kinds. Verified the same way.
- [x] 3.3 The player: its bar, the curriculum beside it or in a drawer, Complete and continue, the course-complete state. Verified by driving it in a browser.
- [x] 3.4 The same in the community's frame. Verified by rendering the demo's community.

## 4. Docs and verification

- [x] 4.1 The Courses docs page, FEATURES.md and the demo config. Verified by `docs-check.mjs`.
