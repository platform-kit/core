## 1. Stop with the run

- [x] 1.1 Handle SIGHUP like SIGINT in `dev.mjs` and `dev-workspace.mjs`. Verify: `dev-workspace.test.mjs` sends SIGHUP to a workspace run with a fake front door and finds every child gone and the port files and run record removed.
- [x] 1.2 Each child watches its run (pid and `runId`) and shuts down when the run is gone. Verify: the same test SIGKILLs the parent and finds every child gone within five seconds.
- [x] 1.3 `dev.mjs` starts Vite and the function server in their own group and signals the group. Verify: a test stops a single-site run and finds no Vite listening on its port.

- [x] 1.4 Every `supabase stop` the dev tooling runs captures its output and gives up after two minutes; a run whose reader has gone drops writes instead of dying. Verify: the real check in `verify.md` (no stop left spinning after a killed run).

## 2. Take over from what a dead run left

- [x] 2.1 Move `dev-stop.mjs`'s identification into a shared module; `platformkit stop` keeps its behaviour. Verify: `dev-stop.test.mjs` unchanged and green.
- [x] 2.2 Before starting, a run stops what dead or abandoned runs of this checkout left (servers, function servers, the front door) and says so in one line per thing. Verify: `dev-workspace.test.mjs` leaves a fake abandoned run holding a port and a front door, starts again, and finds them stopped and the message printed.
- [x] 2.3 Anything not provably this checkout's is never signalled: the run moves to a free port or stops as today. Verify: the test holds a port with an unrelated listener and finds it untouched.
- [x] 2.4 A living attached run still refuses a second. Verify: the test starts two runs and finds the second refused with the existing message.

- [x] 2.5 Take-over (and `platformkit stop`) signal a dead run's site servers and wait for them to finish stopping before touching its stacks and folder. Verify: `dev-workspace.test.mjs` "a start straight after a kill waits for the dying run's servers to finish stopping".

## 3. The page and the whole

- [x] 3.1 The docs page on the dev server says a restart takes over from an abandoned run. Verify: `docs-check.mjs`.
- [ ] 3.2 By hand: `npm run dev` at the root, close the terminal tab, open another and run `npm run dev` again; it starts, naming what it stopped. Verify: recorded in `verify.md`.
