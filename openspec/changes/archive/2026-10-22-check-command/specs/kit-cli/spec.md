## MODIFIED Requirements

### Requirement: The commands

`platformkit` SHALL offer `dev` (the site on one held port with its stack and functions), `build`, `deploy` (with the environment checks first), `test` (the kit's tests plus the site's), `migrate` (assemble and apply; `reset`), `functions` (assemble and serve or deploy), `print`, `tts`, `enrich`, `probe` (the phone probe), `spec` (OpenSpec validate over both roots), `generate` (a new module, page, content type, function, test or build step, in the site by default or in PlatformKit with `--level core`) and `check` (every problem with the machine, the site, its settings and its database, at once), each taking `--site <path>` and defaulting to the current directory.

#### Scenario: a site with no code

- **WHEN** `platformkit dev` runs in a directory holding only a config and content
- **THEN** the site serves on the first free port from 5173 with its stack up and its functions served

Verified by: the demo in the kit's CI

#### Scenario: check is a command

- **WHEN** `platformkit check` runs in a site with nothing wrong
- **THEN** it reports every check passed and exits zero

Verified by: `build/check.test.mjs`

#### Scenario: generate is a command

- **WHEN** `platformkit generate` runs with no kind
- **THEN** it lists the kinds and exits without writing anything

Verified by: `build/generate.test.mjs`
