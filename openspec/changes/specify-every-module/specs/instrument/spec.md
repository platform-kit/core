## ADDED Requirements

### Requirement: The site's own assessments run in the reader's app

The `instrument` module SHALL run a site's own assessments in the reader's app, with screens such as a choice, a choice with "other", information, a timed one-word answer, a spoken sentence, and a closing book recommendation. The questions, scoring and meaning SHALL belong to the site, through its registered graders.

#### Scenario: an assessment taken

- **WHEN** a reader takes the site's assessment in a browser
- **THEN** each screen accepts its answer and the result screen is reached

Verified by: `build/interaction.test.mjs` under `platformkit test --e2e`

### Requirement: Answers belong to the reader

Answers, results and signals SHALL be saved to the reader's account, optionally only once their address is confirmed, and SHALL be readable by that reader alone.

#### Scenario: another reader's results

- **WHEN** a reader asks for another reader's results
- **THEN** none are returned

Verified by: `build/ownership.test.mjs` under `platformkit test --e2e`

### Requirement: The app area has the tabs its modules give

The reader's app SHALL show the site's own tabs, plus accomplishments, coaching or sessions, and chat, each only while its module is on.

#### Scenario: coaching off

- **WHEN** the coaching module is off
- **THEN** the app area has no chat tab

Verified by: no test yet
