## ADDED Requirements

### Requirement: A lesson marks its key ideas as the e-book does

A lesson's text and a course's description SHALL draw the house marks, `==text==` with an optional colour (`{sun}`, `{leaf}`, `{sky}`, `{ocean}`, `{ember}`; sun by default), exactly as the e-book reader draws them: a wavy coloured underline, with no background. A mark SHALL keep the markdown inside it.

#### Scenario: a marked line in a lesson

- **WHEN** a lesson's text contains `==You choose, and God does the work.=={sun}`
- **THEN** the player shows the sentence with the sun wave under it and without the markup

Verified by: a lesson rendered in the player at 1280 px light and 390 px dark, and a book in the e-book reader still drawing its marks
