# Proposal

## Why

A team with its own front end (Next.js, Astro, a phone app) can't use PlatformKit without its reader pages. The APIs already serve other clients, but nothing turns the pages off or checks which modules work without them.

## What Changes

- A site can declare `headless: true`. The kit still builds every interface that isn't the site's own reader pages:
  - the admin and the API reference at `/api`;
  - the pieces other websites embed: the support widget, comment threads, forms, the booking page and the analytics script;
  - the pages a front end sends people to: checkout, the billing portal, video calls and sign-in callbacks.
- What it drops is the reader-facing site: home, library, store, community and the rest, with their prerendering, sitemap and share images. The site's own front end replaces them.
- The site names the origins of its own front ends (`headless: { origins: [...] }`). The functions and APIs accept requests from those origins and refuse others.
- Each module manifest answers for the headless shape as it does for static, git and cloud: `true`, `false` with the reason, or an exception naming what it lacks.
  - With an API (content, store, forms, sessions, support, network): `true`. Only a reader page (page builder, instrument): `false`.
- The build refuses a headless site with a module switched on that answers `false`, naming the module and the reason, all at once.
- The site names where its front end handles the links in the kit's emails (confirm an address, reset a password, receipts, bookings). The deploy is refused until every one is named.
- `platformkit dev` serves the same set.
- A docs page: what a headless site gets, gives up, and how its front end signs readers in.

### What the root address says

Purpose: someone who opens the site's address learns it has no pages and where to go.

> This address serves PlatformKit's backend for {site name}. Staff: /admin · Developers: /api

## Non-goals

- A front end for any framework. The site builds its own.
- Content-only use with no backend. The content API needs one.

## Review focus

Each module's headless answer, especially support, spaces and sessions, where part of the work happens in a page. Also the origin rule for sign-in from another domain.

## Capabilities

### New Capabilities

- `headless-sites`: the switch, what it builds and serves, the origins rule and the root page.

### Modified Capabilities

- `module-manifest`: "A module answers for all three deployment shapes" becomes four answers, adding headless.

## Impact

- Build and dev: routes marked staff, developer, embed or hosted are kept; reader pages, prerender and the sitemap are skipped; `/` serves the notice.
- Functions: an origin check shared by every function.
- Manifests: one more answer per module, kit and site.
- Docs: a "Headless sites" page and the module matrix.
- Sites that don't set it: no change.