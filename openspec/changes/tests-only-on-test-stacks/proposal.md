# Proposal

## Why

A stack test started by hand with a dev run's environment ran against the dev database. On 2026-10-23 that made the courses test unpublish the demo's real courses and leave its rows behind. The end-to-end run already gives every test a fresh stack of its own; the helper still accepted whatever stack the environment named outside it, and so did the storage helpers' route to a database.

## What Changes

- A test reaches a database only inside the end-to-end run, and only the run's own `pk_<site>_e2e` stack, checked against Docker before the test may use it.
- Outside the run, a stack test finds no stack and skips. Inside it, an address that is not an end-to-end container ends the test, naming what answered.
- The same holds for every route a test takes: the test helper, the storage helpers, and any child a test starts.

## Non-goals

- Changing how the end-to-end run builds its stacks.
