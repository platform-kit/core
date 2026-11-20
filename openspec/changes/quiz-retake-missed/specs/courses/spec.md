## ADDED Requirements

### Requirement: A quiz says what a failed attempt retakes

A scored form with a pass mark SHALL accept `#! on-failure = retake-all | retake-missed`; `retake-all` SHALL be the default. With `retake-all`, an attempt after a failed one SHALL ask every question. With `retake-missed`, an attempt after a failed one SHALL ask only the scored questions answered wrong in that attempt, SHALL carry its right answers into the new attempt, and SHALL grade the new attempt on every scored question. The setting SHALL be refused on a form without a pass mark, on a workbook form, and on a form allowing one response.

#### Scenario: only the missed questions

- **WHEN** a reader fails a `retake-missed` quiz with 19 of 25 and starts again
- **THEN** only the six questions they got wrong are asked, and answering them all right scores 25 of 25 and passes

Verified by: a course quiz lesson driven in a browser

#### Scenario: the whole quiz by default

- **WHEN** a reader fails a quiz that does not set `on-failure` and starts again
- **THEN** every question is asked

Verified by: a course quiz lesson driven in a browser

#### Scenario: a setting that cannot apply

- **WHEN** a form sets `on-failure` without a pass mark, or alongside `workbook` or `once`
- **THEN** the form's parse reports an error on that line

Verified by: `build/forms.test.mts`
