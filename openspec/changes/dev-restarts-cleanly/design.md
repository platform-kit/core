## Context

`dev-workspace.mjs` spawns one `dev.mjs --single` per site with `detached: true` (its own process
group) and stops them in a `finally` reached only on SIGINT, SIGTERM or an error. `dev.mjs` spawns
Vite and `supabase functions serve` through `npx` and kills them on SIGINT and SIGTERM. Neither
handles SIGHUP (a closed terminal), and nothing runs on SIGKILL. Each run writes a record under
`.platformkit/dev/runs/<pid>.json` and a `<site>.port` file; `dev-stop.mjs` reads them, checks a
process's command and working directory before signalling it, and stops the front door and the
run's Supabase projects.

## Goals / Non-Goals

**Goals:** a closed tab, a kill or a crash never blocks the next start; nothing that is not this
checkout's is ever signalled.

**Non-Goals:** running two live dev runs of one checkout at once; changing ports, the front door or
how stacks are chosen.

## Decisions

1. **Children watch their parent.** Every child the run starts notes its parent when it starts and
   checks every two seconds that it still has it (`process.ppid`: a child whose parent died is
   re-parented), shutting down cleanly when it does not. This covers SIGKILL, which no handler can. SIGHUP is handled like
   SIGINT in both scripts. *Rejected:* dropping `detached` so the terminal's signal reaches the
   group — it still loses a SIGKILL, and the group is what lets a stop take a whole site down.
2. **Vite and the function server are signalled as a group.** `dev.mjs` starts them in their own
   process group and signals the group, so `npx`'s child is reached.
3. **Take-over reuses `dev-stop.mjs`'s identification.** Its checks (command and working directory,
   the run record, the compose project named from the checkout) move into `dev-owner.mjs`, which both
   import. A run is identified by its PID **and when that PID started** (the record now keeps the
   start time): the run id was only ever in the environment of the run's children, never of the run
   itself, so the old check could not recognise a workspace run at all. Before starting, a run reads
   the records: one whose process is gone, or alive but re-parented to init (whoever started it is
   gone), is stopped and removed; a living run, and every server under it, is left alone, and the
   existing port guard refuses a second as today.
4. **The front door is reconciled, not refused.** The compose project is named from the checkout, so
   a new run brings that project down before bringing it up.

5. **A dying run's servers finish stopping before take-over touches their stacks.** A workspace's site
   servers carry its id in their environment (set when they were started, so `ps` shows it). Take-over
   and `platformkit stop` signal them and wait — up to two minutes each — before stopping the run's stacks
   or deleting its folder. Found by the real check: without it the new run started a stack an old
   server was still stopping, and the old server's `supabase stop` hung once its folder was deleted.
6. **`supabase stop` never writes to the run's own streams.** The CLI does not fail when its output
   goes to a stream nobody reads (a killed parent, a closed terminal): it spins at full CPU forever —
   seen holding two cores for half an hour. Every stop the dev tooling runs captures its output and is
   killed after two minutes (`stopStack` in dev-runtime.mjs), and a run whose reader has gone drops
   its writes instead of dying of EPIPE (`quietOnClosedStreams`).

## Risks / Trade-offs

- A poll every two seconds per child is cheap; a dead run's servers live at most that long.
- "Abandoned" is read as re-parented to init (`ppid` 1). A run deliberately left to init — started
  with `nohup … &` from a shell that then exits — is taken over by the next start; that is the point.
