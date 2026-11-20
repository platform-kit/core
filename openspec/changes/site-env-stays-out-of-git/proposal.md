# Proposal

## Why

A site's `.env` holds its payment, mail and API keys. A site repository is the site's own, and only its `.gitignore` kept `.env` out of it. A new site, a hand-made one, or one whose `.gitignore` was trimmed would commit every key with the first `git add .`.

## What Changes

- Wherever the kit runs in a site (every `platformkit` command, and every site `npm run dev` serves), it writes `.env` and `.env.*`, but not `.env.example`, into the clone's own `.git/info/exclude`. Git's per-clone ignore file applies whatever the site's `.gitignore` says.
- An ignore rule can't stop `git add -f`. So while any such file is tracked, the kit refuses to run and says how to take it out of git. A committed secret can never build or deploy.

## Capabilities

### Modified Capabilities

- `site-repositories`: a site's secrets file stays out of its repository.

## Impact

- `packages/kit/build/env-guard.mts` and its test; `bin/platformkit.mjs` and `build/dev.mts` call it.
- The environment variables reference page.
