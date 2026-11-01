## Tasks

- [x] `courses.kinds` read from the config, refused for a kit kind's name, and handed to the theme and the build
- [x] `courses-io` accepts a registered kind, runs its `check`, refuses an unknown one by name; the push writes it
- [x] `46-courses.sql`: the kind check allows a registered kind; completing one is recorded as a text lesson is
- [x] `CoursePlayer.vue` renders a registered kind's component and completes the lesson from it
- [x] Sidebar and outline: a section with a measured kind shows the measure; the course's overall percentage still counts lessons
- [x] The demo registers a self-rating kind whose measure is the reader's rating; `build/courses.test.mjs` covers accept, refuse and remove; `build/courses-db.test.mjs` covers the write, the completion and the database's kind check
- [x] Courses and extension-model pages of the documentation site
- [ ] Seen in the player at 1280 px and 390 px
