## MODIFIED Requirements

### Requirement: A module answers for all three deployment shapes

Each manifest SHALL say what its module does in static, git and cloud, and whether it works headless — `true`, `false`, or an exception naming the one operation it lacks, why, and the change that closes it (or, for headless, the API a front end uses instead). The deployment matrix SHALL be built from those answers rather than written out, and a claim the code does not back SHALL fail, in both directions: a module claiming cloud with a projected table and no projection hook, a module claiming headless that owns reader routes and no API, and an exception whose gap has since been closed.

#### Scenario: a new module with no answer for a shape

- **WHEN** a manifest omits one of the three shapes or the headless answer
- **THEN** the build refuses it — a module answers for all four in the commit that adds it

Verified by: `build/modes.test.mjs`, which derives the matrix from the manifests

#### Scenario: an exception that is no longer true

- **WHEN** a manifest declares an exception whose gap the code has since closed
- **THEN** the check fails, because a feature nobody knows they have costs as much as one that is missing

Verified by: `build/modes.test.mjs` (the existing derivation, reading manifests)

#### Scenario: a headless claim with nothing to reach

- **WHEN** a manifest answers `true` for headless but owns reader routes and no API or function
- **THEN** the check fails, naming the module

Verified by: `build/modes.test.mjs`
