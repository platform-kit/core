## ADDED Requirements

### Requirement: The end-to-end run runs its own copy of the code

The end-to-end run SHALL run from a copy of the checkout made for the run: the files git tracks or would track, with each fetched site and the settings files, and none that `.gitignore` names. The copy SHALL install its packages from scratch, and SHALL compile each site's content and run its prepare steps before anything is served. The tests, the functions and the app SHALL run from the copy, so nothing in the developer's checkout — a running dev server's rewrites included — can change what a run sees.

#### Scenario: the code under test is the run's copy

- **WHEN** a run over two sites probes each from its tests
- **THEN** the probe script and the functions each stack serves are inside the run's copy, not the checkout

Verified by: `build/e2e-runner.test.mjs`

#### Scenario: nothing an earlier build left

- **WHEN** a run starts on a checkout with no installed packages' leftovers, no compiled content and no built drop-in scripts in the copy
- **THEN** the run installs, compiles and builds them itself and reaches its tests

Verified by: `build/e2e-runner.test.mjs`
