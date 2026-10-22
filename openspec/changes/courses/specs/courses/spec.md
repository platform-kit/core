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

A reader SHALL see a course page with its outline, their progress and "Continue"; a lesson page with the outline beside it, previous and next; and their courses in their app area. Staff SHALL see each course's enrollments, each person's progress, completion rates and the lesson where people stop most. Readers SHALL get an email when a lesson opens (once per lesson) and when they finish, within the site's email caps.

#### Scenario: a new lesson opens

- **WHEN** a drip course opens a lesson for 200 enrolled readers on the same day
- **THEN** each gets one email for it, within the site's caps, and none gets a second

Verified by: `build/courses-db.test.mjs`
