## MODIFIED Requirements

### Requirement: `npm test` holds every rule

`npm test` SHALL run, in order: product keys, the catalog, the emails, the funnels, the audience rules, the word test, the charts, the results sheet, the copy, the mechanism, the bank lint, the complexes, tailwind, the companions, the speech names, the chat model, the support grammar, the deploy checks, and `openspec validate --all --strict`. Three results-sheet cases fail under node for want of WebCrypto in loro and the bank lint reports content findings — both known, neither a regression.

It SHALL additionally run the three deployment shapes as **distinct lanes**, so that a shape is exercised rather than assumed:

- **static** — a site built with no Supabase in the environment, prerendered, served, and every route visited with the console and the network watched: every page renders, nothing logs an error, and nothing asks a backend for anything.
- **git** — the suite above, over a checkout with a backend.
- **cloud** — the demo over rows with nothing that rebuilds: a draft save moves no projection, a publish moves every one, and what the functions read comes from the rows rather than the shipped file.

A lane SHALL be skipped only with a note saying why, never deleted, and a skipped lane SHALL be reported rather than pass in silence.

The checks that need a database, the functions or a browser SHALL NOT be claimed by `npm test`: they run under `platformkit test --e2e`, in the environment the `test-environment` capability describes, where a skip is a failure. `npm test` SHALL name them in one line, so nobody reads its result as covering them.

#### Scenario: a rule changes

- **WHEN** any pinned behaviour changes
- **THEN** its test fails before the change is reported

Verified by: `npm test`

#### Scenario: the three lanes

- **WHEN** `npm test` runs
- **THEN** each lane runs and reports, and a failure names the shape it failed in

Verified by: `build/modes.test.mjs` and the lane runners it drives

#### Scenario: the static lane over more than the docs site

- **WHEN** the static lane runs
- **THEN** it covers both a site with every module off and a site with the library on and every row-backed module off, since the second is the shape most sites of this kind take

Verified by: the static lane, over `sites/docs` and a library fixture

#### Scenario: a heavy lane

- **WHEN** a lane is too slow for the default run
- **THEN** it is skipped with a note naming what is not covered, and reported at the end of the run

Verified by: `build/modes.test.mjs`

#### Scenario: a check that needs a stack

- **WHEN** `npm test` runs and no test environment is up
- **THEN** it names the stack-backed checks as belonging to `platformkit test --e2e` in one line, and does not report them as passed

Verified by: `npm test`
