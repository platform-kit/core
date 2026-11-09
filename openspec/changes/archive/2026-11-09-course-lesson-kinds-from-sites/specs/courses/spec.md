## ADDED Requirements

### Requirement: A lesson may be of a kind the site registers

A course file SHALL be able to name, as a lesson's `kind`, any kind the site registers in `courses.kinds` as well as the kit's own. The build SHALL refuse a lesson whose kind is neither, naming the lesson and the kind, and SHALL run the registered kind's check of the lesson's `ref` where it has one. The player SHALL render a registered kind's lesson with the site's component, given the lesson, its `ref` and the reader's enrollment. The component SHALL complete the lesson as a reader marks a text lesson complete, and the server SHALL record it the same way, subject to the same opening, ordering and drip rules.

#### Scenario: a site's lesson in a course

- **WHEN** the demo registers its self-rating kind and a demo course names a lesson of it
- **THEN** the build accepts the course, the player shows the self-rating where the lesson's words would be, finishing it marks the lesson complete, and the next lesson opens as after any other

Verified by: `build/courses.test.mts` and the demo course in the player

#### Scenario: a kind nobody registered

- **WHEN** a course names a kind that is neither the kit's nor registered
- **THEN** the build refuses the course, naming the lesson and the kind

Verified by: `build/courses.test.mts`

### Requirement: A section can show a site kind's measure

A registered kind MAY provide a progress measure. Where a section holds a lesson of such a kind, the section's bar and percentage in the player's sidebar and the course outline SHALL show that measure for the reader (a number from 0 to 100, or nothing yet), in place of lessons done out of lessons total. The course's completion, certificate and overall percentage SHALL still count lessons.

#### Scenario: a measured section

- **WHEN** a section holds a lesson whose kind measures the reader at 40
- **THEN** that section's bar reads 40% while the course's overall percentage still counts lessons done

Verified by: the demo's self-rating kind, whose measure is the reader's rating, in the player at 1280 px and 390 px
