## ADDED Requirements

### Requirement: Check reports every problem with a site's setup at once

`platformkit check` SHALL check the machine (Node version, Docker, the Supabase CLI, the test browser), the site (its config loads, every switched-on module is known, PlatformKit's version matches the site's pin), its settings (every key its switched-on features need, from the deploy check's own derivation) and its local database (it answers; with `--db`, the plan between it and the declaration is empty). On the developer's machine a missing setting SHALL be a warning, since a feature without its key runs in practice mode or not at all, and the rules only production has (a live key, an https origin) SHALL not apply; with `--production` the deploy check SHALL run whole against `.env.production` and every gap SHALL fail. It SHALL run every check without stopping at the first failure, print failures first, then warnings, each with the command or setting that fixes it, and exit non-zero when any check fails.

#### Scenario: a key missing locally and in production

- **WHEN** a build step's key is unset
- **THEN** `check` warns about it and exits zero, and `check --production` fails on it

Verified by: `build/check.test.mjs`

#### Scenario: two problems at once

- **WHEN** Docker is not running and the test browser is missing
- **THEN** both are reported in one run, each with its fix, and the command exits non-zero

Verified by: `build/check.test.mjs`

#### Scenario: one list of needs

- **WHEN** a module's manifest adds a required setting
- **THEN** `check` and `deploy` both ask for it, with no second list edited

Verified by: `build/check.test.mjs`

### Requirement: Online checks are opt-in and change nothing

With `--online`, check SHALL make one read-only call per configured outside service to confirm its key is accepted, and SHALL report a service it couldn't reach separately from one that refused the key. Without `--online` it SHALL make no network call outside the local machine.

#### Scenario: offline by default

- **WHEN** `platformkit check` runs without `--online`
- **THEN** no request leaves the machine

Verified by: `build/check.test.mjs`, with outside network calls refused

#### Scenario: a refused key

- **WHEN** `--online` runs with a Stripe test key that Stripe rejects
- **THEN** the report says the key was refused, not that Stripe was unreachable

Verified by: `build/check.test.mjs`, against a stub service
