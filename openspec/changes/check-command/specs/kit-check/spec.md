## ADDED Requirements

### Requirement: Check reports every problem with a site's setup at once

`platformkit check` SHALL check the machine (Node version, Docker, the Supabase CLI, the test browser), the site (its config loads, every switched-on module is known, PlatformKit's version matches the site's pin), its settings (every key its switched-on modules need, from the deploy check's own derivation) and its local database (up, and matching the declaration). It SHALL run every check without stopping at the first failure, print failures first with the command or setting that fixes each, and exit non-zero when any check fails.

#### Scenario: two problems at once

- **WHEN** the test browser is missing and a key the store needs is unset
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
