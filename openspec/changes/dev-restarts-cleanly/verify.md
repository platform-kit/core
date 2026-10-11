# Verification — restarting the dev command, scenario by scenario (2026-10-08)

Each scenario is reported as **passed** (its named verifier ran and held), **observed** (seen on the
real workspace), or **not verified** (with what it would take).

## build-and-dev — Restarting the dev command always works

| Scenario | Result |
| --- | --- |
| a closed terminal, then a new start | **passed** — `dev-workspace.test.mjs` pins cleanup after SIGHUP and SIGKILL, then immediate restart. **Observed** on the generic workspace fixtures: the run was killed and restarted; selected sites recovered without stopping unrelated processes or backend projects. **Not verified**: closing a literal terminal tab; SIGHUP and SIGKILL are covered by the test. |
| a port held by something else | **passed** — `dev-workspace.test.mjs`: a listener that is not the site's Vite, on a port a record names, is reported ("not a verifiable PlatformKit Vite process") and still answers afterwards. |
| two live runs | **passed** — `dev-workspace.test.mjs`: with a run alive, a second start is refused with the existing message and says nothing about taking over; the first then stops cleanly. |

## What the real check found

Three faults the fixtures could not show, each fixed and pinned:

1. **A run's id was never in its own environment.** It is set after the run starts, so `ps` never shows
   it — the old `platformkit stop` could not recognise a workspace run, and a parent check that asked
   for it (added in a parallel Copilot session) made every site stop itself two seconds after
   starting. A run is now named by its PID and when it started; the parent check asks only whether
   the parent is the one it was given.
2. **A new run started a stack an old server was still stopping.** Take-over now waits for a dead run's
   site servers to finish before touching its stacks and folder.
3. **`supabase stop` spins forever when nobody reads its output.** A killed run's servers left it holding
   two cores for half an hour. Every stop now captures its output and is cut off after two minutes.

## The suites

`dev-workspace.test.mjs` 11/11, `dev.test.mjs` 5/5, `dev-stop.test.mjs` 2/2, `docs-check.mjs` clean,
`openspec validate dev-restarts-cleanly --strict` valid.
