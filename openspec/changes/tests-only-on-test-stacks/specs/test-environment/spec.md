## ADDED Requirements

### Requirement: A test never reaches any stack but the run's own

A test SHALL reach a database, a function or a stack's API only inside the end-to-end run, and only on the stack that run built for it from the site's files. Before a test may use a stack, its API and its database SHALL be shown by Docker to be end-to-end containers (`…_e2e`). This SHALL hold however the test is started and whatever its environment names, for the test helper, the storage helpers and every process a test starts. Outside the run there SHALL be no stack, and a stack test SHALL skip.

#### Scenario: a test started by hand with a dev stack in its environment

- **WHEN** a stack test is started outside the end-to-end run with a dev run's addresses and keys in its environment
- **THEN** it is given no stack, the storage helpers give it no address or key, and it skips without touching the dev database

Verified by: `build/test-stack.test.mjs`

#### Scenario: a dev stack named as the run's

- **WHEN** a test inside the end-to-end run is given an address whose port Docker shows belongs to a dev stack, or to nothing
- **THEN** the test ends, naming what answered on that port, before it reaches it

Verified by: `build/test-stack.test.mjs`
