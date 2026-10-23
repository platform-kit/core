## ADDED Requirements

### Requirement: A course is sections and lessons in order

With the `courses` module on, a site SHALL be able to publish courses, each with a title, description, image, sections and lessons in order. A lesson SHALL be either its own text and media (video, audio, downloads) or a pointer to an existing book chapter, article, form or session type, named by id. Courses SHALL be edited in the admin's course builder, with sections and lessons reordered by dragging, and SHALL follow the site's deployment shape for drafts and publishing. With the module off, every course page, admin screen, email and table SHALL be absent.

#### Scenario: a lesson that points at a chapter

- **WHEN** a lesson points at a book chapter and the chapter is renamed
- **THEN** the lesson still opens that chapter

Verified by: `build/courses.test.mjs`

### Requirement: Getting into a course creates an enrollment

A course SHALL be reachable by purchase, by a membership tier that includes it, or free to signed-in readers, using the site's access rules. The first time a person gains access, an enrollment SHALL be created as its own record, holding the person, the course, the cohort if any, and when it started and completed. Losing access SHALL close the lessons but keep the enrollment and its progress, and regaining access SHALL resume it.

#### Scenario: a refund and a return

- **WHEN** a buyer finishes three lessons, is refunded, then buys again
- **THEN** the lessons close after the refund, and after the second purchase the same enrollment reopens with three lessons complete

Verified by: `build/courses-db.test.mjs`

### Requirement: The server decides which lessons are open

A course SHALL release its lessons all at once, one lesson or section every N days from enrollment, or on fixed cohort dates, and MAY require each lesson to be complete before the next opens. One database rule SHALL answer, per enrollment, which lessons are open and why each closed one isn't. A closed lesson's text and media SHALL never be sent to the reader.

#### Scenario: a lesson not yet released

- **WHEN** a reader enrolled yesterday requests a lesson that opens in a week
- **THEN** the answer says when it opens, and none of its text or media is sent

Verified by: `build/courses-db.test.mjs`

### Requirement: Lessons and courses are completed and certified

A lesson SHALL complete when the reader marks it done, passes its quiz, or finishes the chapter or form it points at. A course SHALL complete when every required lesson is complete; completion SHALL award the course's achievement where achievements are on, and SHALL issue a certificate where the course offers one. A certificate SHALL have a public address showing the person's name, the course and the date to anyone, and SHALL be downloadable as a PDF.

#### Scenario: the last lesson

- **WHEN** a reader completes the last required lesson
- **THEN** the enrollment is complete, the achievement is awarded, and a certificate answers at its public address

Verified by: `build/courses-db.test.mjs` and `build/courses.test.mjs` in a browser

### Requirement: Readers and staff see where everyone is

A reader SHALL see a course page with its outline, their progress and "Continue"; a lesson page with the outline beside it, previous and next; and their courses in their app area. Administrators SHALL see each course's enrollments, each person's progress, completion rates and the lesson where people stop most. Readers SHALL get an email when a lesson opens after they started (once per lesson, and at most one lesson email a day to a person) and when they finish.

#### Scenario: a new lesson opens

- **WHEN** a drip course opens a lesson for somebody enrolled before it opened
- **THEN** one email is owed for it, the next lesson waits until the following day, and no lesson is owed twice

Verified by: `build/courses-db.test.mjs`

### Requirement: Courses live on their own pages or as a place of the community

A site SHALL choose where its courses live with `courses.where`: `standalone` (the default), pages of their own at `/courses`; or `community`, a place of the community's navigation at `<community>/courses`, registered as a site's own place is, with `/courses` and every address under it forwarding there. The list, course and lesson SHALL be the same component, the same data and the same rules in both. A certificate SHALL keep its public address in both. `community` SHALL be refused, by name, when the spaces or network module is off, and no site SHALL register a place of its own called `courses`.

#### Scenario: a course in the community

- **WHEN** a site sets `courses.where: community` and somebody opens `/courses/<slug>`
- **THEN** it forwards to `<community>/courses/<slug>`, drawn in the community's frame with Courses selected in its navigation

Verified by: `build/courses.test.mjs` (the place, its claim and the forward) and the demo rendered at 1280 and 390 px

#### Scenario: a community with no network

- **WHEN** a site sets `courses.where: community` with the network module off
- **THEN** the build refuses it, saying the community needs the spaces and network modules

Verified by: `build/courses.test.mjs`
