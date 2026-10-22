# Proposal

## Why

A team that already has a front end, in Next.js, Astro or a phone app, can't use PlatformKit for only the backend. A site can replace the theme piece by piece or whole, and the content and compatibility APIs already serve other clients. But nothing declares "no reader pages", so the build still produces them, and nothing checks which modules work without them.

## What Changes

- A site can declare `headless: true`. The kit then builds and deploys the database, backend functions, the admin, the APIs and the API reference at `/api`, and no reader-facing pages.
- The site names the origins of its own front ends (`headless: { origins: [...] }`). The functions and APIs accept requests from those origins and refuse others.
- Each module manifest answers for the headless shape as it does for static, git and cloud: `true`, `false` with the reason, or an exception naming what it lacks.
  - Modules with an API, such as content, store, forms, sessions, support, spaces through Matrix, and the network through AT Protocol, answer `true`.
  - Modules whose only surface is a page, such as the page builder and the instrument, answer `false`.
- The build refuses a headless site with a module switched on that answers `false`, naming the module and the reason, all at once.
- The site names where its front end handles the links in the kit's emails (confirm an address, reset a password, receipts, bookings). The deploy is refused until every one is named.
- `platformkit dev` on a headless site serves the stack, the functions, the admin and `/api`, and nothing at `/`.
- A docs page: what a headless site gets, gives up, and how its front end signs readers in.

### What the root address says

Purpose: someone who opens the site's address learns it has no pages and where to go.

> This address serves PlatformKit's backend for {site name}. Staff: /admin · Developers: /api

## Non-goals

- A front end for any framework. The site builds its own.
- Dropping the admin. It stays, so staff keep one place to work.
- Content-only use with no backend. The content API needs one.

## Review focus

Each module's headless answer, especially support, spaces and sessions, where part of the work happens in a page. Also the origin rule for sign-in from another domain.

## Capabilities

### New Capabilities

- `headless-sites`: the switch, what it builds and serves, the origins rule and the root page.

### Modified Capabilities

- `module-manifest`: "A module answers for all three deployment shapes" becomes four answers, adding headless.

## Impact

- Build and dev: the router, prerender and `dev` skip reader pages; `/` serves the notice.
- Functions: an origin check shared by every function.
- Manifests: one more answer per module, kit and site.
- Docs: a "Headless sites" page and the module matrix.
- Sites that don't set it: no change.