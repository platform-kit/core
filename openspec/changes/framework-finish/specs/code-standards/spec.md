## ADDED Requirements

### Requirement: Code is formatted and linted the conventional way

Every code file in the kit and the fixture sites SHALL be formatted by Prettier and linted by ESLint with the TypeScript and Vue rules and the module boundary rule, and `platformkit check` SHALL fail on any violation.

#### Scenario: an unformatted file

- **WHEN** a code file that Prettier would change is checked
- **THEN** `platformkit check` fails, naming the file

Verified by: `build/standards.test.mts`, with a planted file

### Requirement: The standards only tighten

The count of `any`s per file, the length of files over 600 lines, and the number of direct database calls in a module's interface files SHALL NOT rise above the recorded baseline. A new file SHALL NOT exceed 600 lines. A count that falls SHALL become the new baseline.

#### Scenario: an increase

- **WHEN** a change adds an `any`, lengthens a file over the limit, or adds a database call to an interface file
- **THEN** `platformkit check` fails, naming the file and the count

Verified by: `build/standards.test.mts`, with planted increases

#### Scenario: a decrease

- **WHEN** a change removes `any`s from a file
- **THEN** the check passes and the baseline records the lower count

Verified by: `build/standards.test.mts`

### Requirement: Pages reach data only through their module's data layer

A module's pages and components SHALL read and write data only through functions in that module's logic, never by querying tables or calling database functions themselves.

#### Scenario: a direct query in a component

- **WHEN** a component queries a table directly
- **THEN** `platformkit check` fails, naming the component

Verified by: `build/standards.test.mts`, with a planted query

### Requirement: Shared code has one import name in every runtime

Code shared by the browser, the build and the edge functions SHALL be imported by the same name in all three.

#### Scenario: one import, three runtimes

- **WHEN** a shared file is imported by name from a component, a build step and an edge function
- **THEN** all three resolve it: the component in the dev server and the built bundle, the step in the build, and the function in the served backend

Verified by: `build/shared-imports.test.mts`, and every function booting under `platformkit test --e2e`

### Requirement: Tests use the standard runner

Every test SHALL use `node:test`, so the standard reporters, filtering and coverage apply.

#### Scenario: a test file

- **WHEN** any kit test file runs
- **THEN** it reports through `node:test`, each check a named test

Verified by: `build/standards.test.mts`, which refuses a test file not using `node:test`
