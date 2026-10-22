## Why

Stopping `npm run dev` the wrong way breaks the next start. Close the terminal tab, or have the
process killed, and the run never cleans up: the site servers it started, their function servers
and the front-door container keep running with nobody owning them. The next `npm run dev` then
finds one of those ports answering and refuses — "brochure already has a dev server on port 5177;
stop it before starting the workspace" — and the person has to hunt processes by hand. On
2026-10-07 that was four workspace servers, two function servers, a front-door container on port
3000 and five demo servers from the week before, one of them so old it predated a module and broke
every page a test opened on it.

Starting, stopping and restarting the dev command must simply work.

## What Changes

- **A run's servers die with it.** Each site server and its Vite and function server stop when the
  run that started them goes, however it goes: Ctrl+C, a kill, a closed terminal, or the parent
  disappearing. The front door is stopped with them.
- **A new run takes over from a dead or abandoned one.** Before starting, `npm run dev` stops
  whatever an earlier run of *this checkout* left behind — the same processes and containers
  `platformkit stop` already identifies safely — and says what it stopped, in one line each. It
  never touches anything it cannot prove is this checkout's: another project's server, an editor's
  port forward, an unrelated process on a port. Those are still reported, and the run moves to a
  free port or stops as it does today.
- **A second live run is still one run.** If an earlier run of this checkout is alive and attached
  to a terminal, the new run says so and stops, as now: two live runs of one checkout would fight
  over the same stacks.

What the person sees on a start after a closed tab:

> Stopped what an earlier dev run left behind: brochure (5177), demo (5179), docs (5181), the front door (3000).

## Capabilities

### Modified Capabilities

- `build-and-dev`: `npm run dev` restarts cleanly after a run that ended without cleaning up.

## Impact

- `packages/kit/build/dev.mjs`, `dev-workspace.mjs`, `dev-stop.mjs` (its identification shared, not
  copied), `dev-runtime.mjs` (the run record says whose a process is).
- The docs page on running the dev server.
- No production code, no schema, no content.
