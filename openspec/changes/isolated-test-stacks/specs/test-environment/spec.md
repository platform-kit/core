## Purpose

The environment end-to-end tests run in: a stack of its own for every site under test, built from the site's files on every run, never a developer's stack.

## ADDED Requirements

### Requirement: End-to-end tests run in their own environment

`platformkit test --e2e` SHALL run every test that needs a database, the functions or a browser in a test environment of its own, and SHALL NOT start, stop, read or write a development stack, its ports or its data. The same command SHALL run locally and in CI.

#### Scenario: a dev stack is running

- **WHEN** `npm run dev` is running a site and `platformkit test --e2e` is run for the same site
- **THEN** the tests run against a separate stack on separate ports, and the dev stack's database, functions and data are exactly as they were before the run

Verified by: the runner's own test, which records a dev stack's row counts and ports before a run and compares them after

### Requirement: Every site has its own stack

The environment SHALL give every site under test its own stack — its own database, functions, mail catcher and ports — and SHALL run several sites side by side in one run. A site's tests SHALL be given only that site's stack.

#### Scenario: two sites in one run

- **WHEN** a run selects two sites with different modules
- **THEN** each site's tests run against its own stack, a record one site's tests make never appears in the other's database, and the run reports each site separately

Verified by: the runner's own test over the demo and a second fixture site

### Requirement: Every stack is built from the site's files on every run

Before any test runs, each site's stack SHALL be built from scratch: the site's declared schema, its data and its seed, then the seed steps a reset runs. Nothing left from an earlier run or an earlier stack SHALL survive into it.

#### Scenario: a schema change

- **WHEN** a schema file changes and `platformkit test --e2e` runs
- **THEN** the tests see the changed schema, with no migration or reset run by hand

Verified by: the runner's own test, which adds a column to a fixture's schema and finds it on the next run's stack

#### Scenario: a crashed run

- **WHEN** a run was interrupted and left its stacks up
- **THEN** the next run removes them and builds new ones rather than reusing their data

Verified by: the runner's own test

### Requirement: The run supplies everything the tests need

Each stack's functions SHALL be served with a test environment the run owns: a known value for every webhook secret, mail delivered to that stack's own catcher, and the provider services the site's configuration names started inside the environment. A live payment key or a production address in the site's environment SHALL refuse the run.

#### Scenario: a webhook test

- **WHEN** the webhook tests run for a site
- **THEN** every forged, altered, stale and replayed event check runs against a real secret, and none is skipped for want of one

Verified by: `webhook-doors.test.mjs` under `platformkit test --e2e`, reporting no skipped check

#### Scenario: a live key

- **WHEN** a site's environment holds a live payment key
- **THEN** the run refuses before starting any stack, naming the key

Verified by: the runner's own test

### Requirement: Tests take their stack from the run

A test SHALL find its site's stack — its addresses, keys, database and mail catcher — only from what the run gives it, never from the folder it was started in or from a fixed port.

#### Scenario: a test started from another folder

- **WHEN** a stack-backed test runs under `platformkit test --e2e`
- **THEN** it uses the stack the run gave it, whatever stack the current folder's own configuration would have named

Verified by: a check in the runner's own test that no stack-backed test reads `supabase status` or a fixed port

### Requirement: A skipped check fails the end-to-end run

In the end-to-end run, a test that cannot run — no stack, no service, no secret — SHALL fail the run and name what was missing, rather than pass as skipped.

#### Scenario: a missing service

- **WHEN** a test needs a service the environment did not provide
- **THEN** the run fails and names the test and the service

Verified by: the runner's own test, with a service withheld

### Requirement: The environment is removed afterwards

When the run ends, by success, failure or interruption, every stack and service it started SHALL be stopped and its data removed, unless the run was asked to keep them.

#### Scenario: an interrupted run

- **WHEN** a run is interrupted
- **THEN** its stacks and services are stopped and their data removed

Verified by: the runner's own test

### Requirement: Nothing is untested by construction

The kit SHALL make an untested function or a silently skipped check a failure rather than a convention to remember: every Edge Function SHALL be named by at least one test; every function SHALL be called during an end-to-end run over every site with a backend; a test SHALL leave before its end only by the helper's skip (a failure in the end-to-end run) or its declared not-on-this-site; and every "Verified by" in a specification SHALL name a test that exists and is run.

#### Scenario: a new function with no test

- **WHEN** a function is added under the kit's or a site's functions and no test names it
- **THEN** `npm test` fails, naming the function

Verified by: `build/test-coverage.test.mjs`

#### Scenario: a function no test calls

- **WHEN** an end-to-end run over every site with a backend finishes and a function any site served was never called by any site's tests
- **THEN** the run fails, naming the function; a run over some of the sites names it without failing, since the others' tests are the ones that call it

Verified by: the runner's coverage gate, read from the functions' own log

#### Scenario: a test that stops early with a pass

- **WHEN** a test exits successfully before its end other than through the helper's skip or not-on-this-site
- **THEN** `npm test` fails, naming the test and the line

Verified by: `build/test-coverage.test.mjs`

#### Scenario: a claim with no test behind it

- **WHEN** a specification's scenario names a test that does not exist or is not run
- **THEN** `npm test` fails, naming the scenario

Verified by: `build/test-coverage.test.mjs`
