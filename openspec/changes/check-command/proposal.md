# Proposal

## Why

When a site won't start, the cause shows up one failure at a time: Docker not running, a missing key, the test browser not installed, a database that doesn't match its declaration. Each surfaces in a different command, and the deploy check only runs at deploy. Loco's `doctor` checks a whole setup in one go. PlatformKit should too.

## What Changes

- A new command, `platformkit check`, checks everything a site needs and lists every problem at once, each with the fix:
  - **The machine:** Node version, Docker running, the Supabase CLI, the test browser.
  - **The site:** the config loads, every module switched on is known, and PlatformKit's version is the one the site pins.
  - **Settings:** every key the site's switched-on modules need is present, using the deploy check's own list.
  - **The database:** the local stack is up, and its schema matches the declaration.
  - **Outside services**, with `--online` only: each configured key is accepted by its service (Stripe, the mail relay, printers, AI providers), using read-only calls that change nothing.
- It exits non-zero when anything fails, so CI can run it.
- `platformkit dev` and `platformkit test` point to it when they fail to start.

### The command's own words

Purpose: one screen, problems first, each with what to do.

> ✔ Node 22.22 · ✔ Docker · ✔ Supabase CLI · ✖ test browser not installed — run `npx playwright install chromium`
>
> ✖ STRIPE_SECRET_KEY is missing — the store is on and sells through Stripe. Set it in .env.
>
> 2 problems. Everything else is ready.

## Non-goals

- Fixing anything. It reports, and prints the command or setting that fixes each problem.
- Checking production. It checks the machine and settings it runs with.

## Review focus

That it reuses the deploy check's list rather than keeping a second one, and that `--online` makes only read-only calls.

## Capabilities

### New Capabilities

- `kit-check`: what the command checks, how it reports, and its exit code.

### Modified Capabilities

- `kit-cli`: "The commands" adds `check`.

## Impact

- CLI: a new command reusing `build/deploy-checks.mjs` and the browser lookup in `build/browser.mjs`.
- Docs: the CLI reference and the getting-started page.
