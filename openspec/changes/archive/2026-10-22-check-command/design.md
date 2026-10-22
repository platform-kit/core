# Design

## Context

See proposal.md for why. Today:

- **Settings** are checked only by `platformkit deploy`, through `build/deploy-checks.mjs`, which derives what each switched-on module needs from its manifest.
- **The browser** is looked up by `browserPath()` in `build/browser.mjs`, which the end-to-end run already asks before building a stack.
- **The database** is compared to its declaration by the assembler and the planner (`assemble --check`, the migrate plan).

## Goals / Non-Goals

**Goals:** every problem in one run; one source for what a site needs; a CI-friendly exit code; online checks that change nothing.

**Non-Goals:** fixing problems; checking a deployed site.

## Decisions

1. **One list of needs, read two ways.** The settings check calls the deploy check's derivation. On the developer's machine its gaps are warnings and its production-only rules (live keys, an https origin, the shadow database) are skipped: run on the demo, the strict reading reported 14 missing keys and 2 wrong settings on a machine that runs fine. `--production` reads `.env.production` and fails on every gap, as the deploy would. Alternative: a list of its own. Rejected because two lists drift.
2. **Each check is a record:** a name, a test, and a fix line. The command runs them all, never stopping at the first failure, and prints failures first.
3. **Online is opt-in.** `--online` adds one read-only call per configured service (for example, Stripe's account lookup). Without it the command makes no network call, so it runs offline and costs nothing.
4. **Dev and test point to it.** When `dev` or `test` fails, the CLI ends with "If it could not start, `platformkit check` lists everything that is missing."
5. **The schema comparison is opt-in.** `--db` runs `migrate --plan`, which builds a shadow database (about a minute) and applies nothing. By default the check only confirms the database answers.

## Risks / Trade-offs

- Online calls can be rate-limited or slow. Each has a short timeout and reports "couldn't reach" separately from "refused".
