## ADDED Requirements

### Requirement: Restarting the dev command always works

A dev run SHALL take its servers down with it however it ends — Ctrl+C, a kill, a closed terminal, or its parent disappearing — and a new run SHALL stop whatever an earlier run of the same checkout left behind (site servers, function servers, the front door), saying what it stopped, before starting. It SHALL never signal a process or container it cannot prove belongs to this checkout's dev runs, and a living run attached to a terminal SHALL still refuse a second.

#### Scenario: a closed terminal, then a new start

- **WHEN** a workspace run's terminal is closed and `npm run dev` is run again
- **THEN** the first run's servers and front door are already gone or are stopped by the new run, which names them, and the new run starts

Verified by: `build/dev-workspace.test.mjs` (SIGHUP and SIGKILL of the parent, an abandoned run taken over); the closed tab itself by hand, NOT VERIFIED by a pinned test

#### Scenario: a port held by something else

- **WHEN** a port a run would use is held by a process that is not this checkout's dev run
- **THEN** that process is not signalled, and the run moves to a free port or stops with the existing message

Verified by: `build/dev-workspace.test.mjs`

#### Scenario: two live runs

- **WHEN** a run of this checkout is alive in a terminal and another is started
- **THEN** the second is refused as today

Verified by: `build/dev-workspace.test.mjs`
