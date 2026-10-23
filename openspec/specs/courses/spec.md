# courses Specification

## Purpose
Courses: sections and lessons in order, released over time and tracked to completion, with certificates — on pages of their own or as a place of the community. The database alone decides what is open to a reader and hands out a lesson's text.

## Requirements

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

A reader SHALL have a library at `/courses`:

- the course they were last active in, with its next open lesson, first;
- then their courses in progress;
- then the courses they finished, each with its certificate where it has one;
- then every other published course, with what getting in takes (free, a membership or a purchase).

A guest SHALL see the catalogue alone.

A course page SHALL show:

- the reader's progress and next step beside the curriculum;
- each section with how many of its required lessons are done;
- each lesson marked with its kind and with what it carries (video, audio, files), and with whether it is done, open or closed and why.

A lesson SHALL open in a player:

- with the curriculum beside it, or behind a control on a phone;
- with the course's progress, previous and next;
- with one action that finishes the lesson and opens the next open one.

Finishing a course's last required lesson SHALL say so in the player and offer the certificate where there is one.

The app area SHALL NOT carry the reader's courses, and `/app/courses` SHALL forward to `/courses`.

Administrators SHALL see each course's enrollments, each person's progress, completion rates and the lesson where people stop most. Readers SHALL get an email when a lesson opens after they started (once per lesson, and at most one lesson email a day to a person) and when they finish.

#### Scenario: a new lesson opens

- **WHEN** a drip course opens a lesson for somebody enrolled before it opened
- **THEN** one email is owed for it, the next lesson waits until the following day, and no lesson is owed twice

Verified by: `build/courses-db.test.mjs`

#### Scenario: the library for a reader part way through

- **WHEN** a signed-in reader who has started one course and finished another opens `/courses`
- **THEN** the course in progress leads, naming its next lesson, the finished course is listed with its certificate, and the courses they are not in follow with what getting in takes

Verified by: `build/courses-db.test.mjs` (what `courses_list` answers) and the library rendered at 1280 and 390 px, light and dark

#### Scenario: complete and continue

- **WHEN** a reader presses Complete and continue on an open lesson
- **THEN** the lesson is recorded done and the player opens the next open lesson; on the last required lesson, it shows the course complete instead

Verified by: the player driven in a browser on the demo

#### Scenario: the app area's address

- **WHEN** somebody opens `/app/courses`, including on a site whose own place claims `/app`
- **THEN** they arrive at `/courses`

Verified by: `build/courses.test.mjs`

### Requirement: Courses live on their own pages and in the community

Courses SHALL have pages of their own at `/courses`. Where the spaces and network modules are on, Courses SHALL also be a place in the community's navigation, at `<community>/courses`, with the same library, overview and player in the community's frame. The library, overview and player SHALL be the same component, the same data and the same rules in both places. A certificate SHALL keep its public address. A site that sets `courses.where` SHALL be refused, by name, with what replaced it. No site SHALL register a place of its own called `courses`.

#### Scenario: a course in the community

- **WHEN** a site with the community on opens its community
- **THEN** Courses is a row of its navigation, `<community>/courses/<slug>` draws the course in the community's frame with Courses selected, and `/courses/<slug>` still draws it on a page of its own

Verified by: `build/courses.test.mjs` (the place and its claim) and the demo rendered at 1280 and 390 px

#### Scenario: a community with no network

- **WHEN** a site has courses on and the network module off
- **THEN** courses have their own pages only, and the community's navigation has no Courses row

Verified by: `build/courses.test.mjs`
