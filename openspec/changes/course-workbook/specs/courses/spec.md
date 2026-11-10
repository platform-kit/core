## ADDED Requirements

### Requirement: A lesson can carry a workbook form

A text lesson SHALL be able to name a form in the course file, shown in the lesson under its text. The course file SHALL say whether answering is required (`answers: required`) or optional (`answers: optional`, the default). With required answers, the lesson SHALL NOT complete until the form is finished. With optional answers, it SHALL complete as a text lesson does. The build SHALL refuse a lesson naming a form that doesn't exist.

#### Scenario: required answers

- **WHEN** a reader opens a lesson whose form is required and presses Complete before finishing the form
- **THEN** the lesson is not completed and the player points them to the form; once the form is finished, the lesson completes

Verified by: `build/courses-db.test.mts` and the player in a browser

### Requirement: A course has a workbook

Each course SHALL have a workbook page for the reader, at `<course>/workbook`, showing every workbook answer they have given in the course by module and lesson, in course order, with lists in their order. It SHALL print cleanly and be linked from the course page and the player.

#### Scenario: the reader's workbook

- **WHEN** a reader who has answered forms in two modules opens the workbook
- **THEN** both modules' answers appear under their lessons in course order, and the page prints without the site's navigation

Verified by: the demo's workbook rendered at 1280 and 390 px, light and dark, and printed to PDF

### Requirement: A reader shares a workbook with a coach

A reader's workbook answers SHALL be private to them by default. A reader SHALL be able to share a course's workbook with a particular coach, and to withdraw it. A coach SHALL be able to read the workbooks shared with them, and SHALL NOT be able to read any others. Each share SHALL be a record of its own, with the reader, the coach, the course, and when it was granted and withdrawn.

#### Scenario: sharing and withdrawing

- **WHEN** a reader shares their workbook for a course with one coach, and later withdraws it
- **THEN** while it is shared, that coach can read it and another coach cannot; after it is withdrawn, neither can

Verified by: `build/courses-db.test.mts`
