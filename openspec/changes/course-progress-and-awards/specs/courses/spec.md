## ADDED Requirements

### Requirement: The curriculum shows progress and pass or fail at every level

In the lesson player's curriculum and on the course overview, every lesson SHALL show one state: done, a quiz passed (with its score), a quiz attempted and not yet passed (with the best score), open, or closed. Every section SHALL show how many of its required lessons are done, a bar of that progress, and a mark when all of them are.

#### Scenario: a quiz not yet passed

- **WHEN** a reader has finished a scored form lesson's form below its pass mark
- **THEN** the curriculum shows that lesson as not yet passed with the best score, distinct from done and from open

Verified by: the player and the overview rendered on the demo at 1280 and 390 px, light and dark

### Requirement: Every quiz passed earns an achievement

Each scored form lesson of a published course SHALL have an achievement, declared by the achievements push from the course file: titled after the lesson's section unless the lesson's `achievement` gives a title, a line and an icon of its own, and absent where it says `achievement: false`. The first time a reader passes that lesson, the server SHALL record a `quiz_passed` event naming the course and the lesson, and the achievements module SHALL award the achievement from it. No client SHALL be able to award it. The player SHALL name the achievement when the quiz is passed, and the achievement SHALL have its own page.

#### Scenario: passing a quiz

- **WHEN** an enrolled reader passes a quiz lesson for the first time
- **THEN** a `quiz_passed` event is recorded, the reader holds that quiz's achievement, and a second pass records no second event

Verified by: `build/courses-db.test.mjs`

#### Scenario: the declaration

- **WHEN** the achievements push runs over a site whose course has scored form lessons
- **THEN** each has an achievement titled after its section, one with its own `achievement` uses that, and one that says `achievement: false` has none

Verified by: `build/courses.test.mjs`
