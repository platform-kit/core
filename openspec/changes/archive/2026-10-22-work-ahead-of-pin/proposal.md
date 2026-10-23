# Proposal

## Why

A fetched site could not be run in the workspace with commits that are not yet pushed: every command that lists sites refused a checkout that was not exactly at its pin, and a pin can only name a pushed commit. So a site owner could not see a change working locally before pushing it, which is the order anyone works in.

## What Changes

- A managed checkout at its pinned commit with local commits on top is accepted. `platformkit sites` and `platformkit dev` say how many commits it is past its pin.
- `platformkit sites update` moves the pin forward to a commit that contains the checkout, without touching the checkout, once the commits are pushed.
- An update that would leave a local commit behind is refused, naming why.
- A checkout neither at its pin nor built on it is still refused, as before.

## Non-goals

- Pinning a commit that is not on the site's remote.
- Any change to how a site builds or deploys from its own repository.

## Review focus

That nothing local can be lost: the update refuses rather than checking out away from unpushed commits.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `site-repositories`: "Fetch and update preserve local work" accepts a checkout ahead of its pin and pins forward to it.

## Impact

- `packages/kit/build/sites.mjs` and `dev-workspace.mjs`; the multiple-sites docs page.
