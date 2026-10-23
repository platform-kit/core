## MODIFIED Requirements

### Requirement: Lessons and courses are completed and certified

A lesson SHALL complete when the reader marks it done, or finishes the chapter it points at. A form lesson SHALL complete, without any action from the reader, the moment they finish the form, or pass it where it is scored. A course SHALL complete when every required lesson is complete; completion SHALL award the course's achievement where achievements are on, and SHALL issue a certificate where the course offers one. A certificate SHALL have a public address showing the person's name, the course and the date to anyone, and SHALL be downloadable as a PDF.

#### Scenario: the last lesson

- **WHEN** a reader completes the last required lesson
- **THEN** the enrollment is complete, the achievement is awarded, and a certificate answers at its public address

Verified by: `build/courses-db.test.mjs` and `build/courses.test.mjs` in a browser

#### Scenario: a quiz passed

- **WHEN** an enrolled reader finishes an open form lesson's scored form with at least its pass mark
- **THEN** the lesson is recorded done by the server as the response completes, and finishing the course's last required lesson this way completes the course

Verified by: `build/courses-db.test.mjs`

#### Scenario: a quiz not passed

- **WHEN** a reader finishes a scored form below its pass mark
- **THEN** the lesson stays open and not done

Verified by: `build/courses-db.test.mjs`

## ADDED Requirements

### Requirement: A quiz runs in its lesson and keeps its score

A form lesson SHALL show its form inside the lesson player, after the lesson's own text, and SHALL NOT send the reader to another page to answer it. When the reader finishes it, the player SHALL show the result in place of the form's own end:

- passed, or an unscored form finished: the score where it is scored, the lesson complete, and the way on to the next lesson;
- not passed: the score, the pass mark and a way to try again.

A form lesson already passed SHALL show the reader's best score and SHALL let them take it again; another attempt SHALL NOT undo the completion. The course SHALL show, against each scored form lesson in the curriculum, the reader's best score. Administrators SHALL see, for each person enrolled, their best score on each scored form lesson and how many attempts they made.

#### Scenario: answering in the lesson

- **WHEN** a reader opens an open form lesson and answers the form to its end with enough right answers
- **THEN** the form ran inside the player, the player says it is passed with the score, the curriculum marks the lesson done with that score, and the next lesson is offered

Verified by: the player driven in a browser on the demo, at 1280 and 390 px, light and dark

#### Scenario: trying again

- **WHEN** a reader finishes the form below its pass mark and chooses to try again
- **THEN** the form starts again from its first question in the lesson, and passing it then completes the lesson

Verified by: the player driven in a browser on the demo

#### Scenario: the staff's view

- **WHEN** an administrator opens a course's enrollments
- **THEN** each person shows their best score on each scored form lesson and how many attempts they made

Verified by: `build/courses-db.test.mjs`
