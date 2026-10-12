# Verification — restarting the dev command, scenario by scenario (2026-10-12)

Each scenario is reported as **passed** (its named verifier ran and held), **observed** (seen on the
real workspace), or **not verified** (with what it would take).

## build-and-dev — Restarting the dev command always works

| Scenario | Result |
| --- | --- |
| a closed terminal, then a new start | **passed** — `dev-workspace.test.mjs` pins cleanup after SIGHUP and SIGKILL, then immediate restart. **Observed** at the root with `PLATFORMKIT_SITES=docs npm run dev`: `http://docs.localhost:3000/` returned 200; after killing the verified run PID, the next start reported `the front door (3000)` and served docs again. The docs-only selection avoided rewriting the external site's dirty generated `supabase/` tree. **Not verified**: a literal terminal-tab close or the default multi-site selection. |
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

`dev-workspace.test.mjs` 12/12, `dev.test.mjs` 5/5, `dev-stop.test.mjs` 2/2, `docs-check.mjs` exactness and source checks clean (87 pages), `openspec validate dev-restarts-cleanly --strict` valid. `docs-check.mjs --tree` still reports eight unrelated stale pages from other changed kit sources.
