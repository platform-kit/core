# kit-cli

## Purpose

One command a site runs for everything the kit does — so a developer never assembles the stack, the functions, the build or the deploy by hand, and the kit's own tests run against any site the same way.

## Requirements

### Requirement: The commands

`platformkit` SHALL offer `dev` (the site on one held port with its stack and functions), `build`, `deploy` (with the environment checks first), `test` (the kit's tests plus the site's), `migrate` (assemble and apply; `reset`), `functions` (assemble and serve or deploy), `print`, `tts`, `enrich`, `probe` (the phone probe) and `spec` (OpenSpec validate over both roots), each taking `--site <path>` and defaulting to the current directory.

#### Scenario: a site with no code

- **WHEN** `platformkit dev` runs in a directory holding only a config and content
- **THEN** the site serves on the first free port from 5173 with its stack up and its functions served

Verified by: the demo in the kit's CI

### Requirement: The deploy checks read the modules

`platformkit deploy` SHALL demand only what the site's modules and content switch on: no printer for a site without print, no cal.com for one without sessions, Stripe only when something is for sale; the mail relay and push always.

#### Scenario: a content-only site

- **WHEN** a site has every commerce module off
- **THEN** the checks ask for Supabase, the site's origin, the mail relay and the VAPID pair, and nothing else

Verified by: `deploy-checks --test` extended with module cases
