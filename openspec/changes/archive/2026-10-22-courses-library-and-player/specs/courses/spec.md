## MODIFIED Requirements

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

## RENAMED Requirements

- FROM: `### Requirement: Courses live on their own pages or as a place of the community`
- TO: `### Requirement: Courses live on their own pages and in the community`

## MODIFIED Requirements

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
