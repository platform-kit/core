---
title: "Analytics from any site: PostHog's SDKs and the script"
description: Any official PostHog SDK pointed at this site, or one script with PostHog's API; the door every event goes through; a site's own events and sources in the config.
order: 56.8
sources:
  [
    packages/kit/src/sdk,
    packages/kit/build/analytics-sdk.mjs,
    packages/kit/build/analytics-config.mjs,
    packages/kit/supabase/functions/ingest,
    packages/kit/src/lib/analytics.js,
    packages/kit/src/lib/arrival.js,
    packages/kit/build/analytics-sdk.test.mjs,
    packages/kit/supabase/functions/_shared/posthog-wire.js,
  ]
reviewed: 2026-09-30
---

## One door for events

Every event — the site's own and any other site's — lands through `<domain>/api/events`, the `ingest` function. It checks an event's name is a well-formed one (letters, digits, `_ $ : .` and spaces, 64 characters), the batch's size (50 rows, 8 KB of properties a row), a source's key and origin, and takes the signed-in user from the caller's session — never from the body — so on a PlatformKit site a signed-in account is identified by its session alone and nothing calls `identify`. It stamps, on a session's first event, the **country** the host's geo header reports: `cf-ipcountry` (Cloudflare), `x-vercel-ip-country`, `cloudfront-viewer-country`, or `x-country` set by any front you run. Locally there is none and the dashboard says _unknown_. No IP address is kept, ever. Six hundred rows a minute per browser, and the site's `limit-analytics` batches an hour per visitor (1200 when the policy says nothing), counted under a hash of the address the platform's proxy wrote — never the address itself, never the caller's own `x-forwarded-for` (`_shared/doors.ts`) — else `429`. A compressed body is opened to a megabyte at most.

The site's own `lib/analytics.js` posts through the same door, on the shared core (`src/sdk/core.js`): the queue and its batches, the session (30 idle minutes), the super properties, the identified person, the standard `$`-properties, and the **anonymous id** — a fingerprint, FingerprintJS's open-source `visitorId` (MIT), computed once per page load and cached, so a guest who clears storage, opens a private window or comes back next month is the same visitor; a random id kept in storage where none can be computed. Under ePrivacy a fingerprint is tracking like a cookie: say so where you say the rest. An **opted-out** browser sends no fingerprint — its events still come, under a random id kept in its storage, so the numbers stay whole and the person stays unrecognised (this is the one place the script departs from PostHog, where opting out silences it).

## Your own events, and the sites that report in

```js
// platformkit.config.js
analytics: {
  events: [
    { key: 'newsletter_signup', label: 'Newsletter sign-up', goal: true },
    { key: 'video_play', label: 'Video played', value: 'seconds' },
  ],
  sources: [{ key: 'pk_landing_7f3a9c2e51d4', name: 'landing', hosts: ['landing.example', 'www.landing.example'] }],
  panels: [...],
}
```

An **event** you register is shown by its label: a `goal` joins Sign-ups · Purchases · Memberships on the dashboard's Overview (a count and a rate per 100 visitors) and gets a column per channel on Acquisition; every registered event is a metric in Explore; the Events tab lists it first. `value` names the property summed as its value. An event a script sends under a name you did not register is kept as sent and listed by that name.

A **source** is another site that reports in through the script: a `key` (the secret a page sends — twelve characters at least; it is public on the page, as PostHog's keys are), a `name` (lower-case words joined by hyphens: the source's name on the dashboard), and the `hosts` allowed to send under it (`*` for any, `*.example` for a domain's subdomains). `node build/analytics-config.mjs` writes both to `supabase/functions/_shared/analytics.json` for the door (a build step, `analytics-config`; `--check` in `platformkit test`); the browser gets the events and the sources' names alone, never a key or its hosts.

## The official PostHog SDKs, pointed here

The door speaks PostHog's wire protocol, so every official PostHog SDK — `posthog-js`, `posthog-react-native`, `posthog-node`, the iOS, Android, Flutter, Go, Python, PHP and Ruby SDKs — reports into this site with one setting changed: its `api_host`. The SDK's own endpoints under it are answered: `/e/`, `/i/v0/e/`, `/capture/` and `/batch/` take PostHog's events in its encodings (gzip-js, base64, plain JSON; a gzipped body from a server SDK), the registered key as the event's `token` or the batch's `api_key`; `/flags/` and `/decide/` answer with every flag off, no recording and no surveys, and gzip-js as the compression to use; `/array/<token>/config.js` an empty remote config; `/s/` (recordings) is accepted and dropped. PostHog's `$device_id` is the anonymous id, `$session_id` the session, `distinct_id` the person, the event's properties the row's.

```js
posthog.init('pk_landing_7f3a9c2e51d4', { api_host: 'https://example.com/api/events' })
```

```js
import { PostHog } from 'posthog-node'
const client = new PostHog('pk_landing_7f3a9c2e51d4', { host: 'https://example.com/api/events' })
client.capture({ distinctId: 'u-7', event: 'signup', properties: { plan: 'monthly' } })
```

The door's routes and shapes are in the site's OpenAPI document and on its reference page at `/api`, under Analytics (see [the content API](/content/docs/building-a-site/contentful-api)). Two spellings of the address: `https://<domain>/api/events` works through the `/v1/*` rewrite every site with the emails' links already has (the SDK appends `/e/`, `/flags/`, `/array/…` to it; the snippet's `/static/array.js` under it redirects to the site's file); the bare domain, `https://<domain>`, needs the host to rewrite PostHog's eight paths as well — `/e/*`, `/i/*`, `/capture/*`, `/batch/*`, `/flags/*`, `/decide/*`, `/array/*`, `/s/*` → `functions/v1/<ref>…/ingest/…` — which `deploy-checks` lists in its notes when a source is registered. Feature flags, surveys, session recording, heatmaps, site apps, the toolbar and error tracking are answered as off, never implemented; a page that relies on a flag being _on_ sees it off. `build/analytics-sdk.test.mjs` runs the real `posthog-js` build in a headless page against the served door (its `opt_out_useragent_filter` on, since PostHog takes a headless browser for a bot) and posts `/batch/` plain and gzipped.

## The script

`<domain>/analytics.js` — built by `node build/analytics-sdk.mjs` (the `analytics-sdk` step of `platformkit build`; the dev server serves it from `dist/` once built) — exposes `window.posthog` with **posthog-js's public surface, name for name**: every method its type declarations list on the `PostHog` class (`init`, `capture`, `identify`, `alias`, `reset`, `register` / `register_once` / `unregister`, `get_distinct_id`, `get_session_id`, `opt_in_capturing` / `opt_out_capturing` / `has_opted_out_capturing`, `setPersonProperties`, `people.set`, `group`, `captureException`, the flags, surveys, recording and the rest), and the queue of calls made before `init`. The test reads the installed `posthog-js` declarations and checks each name is there, so a method PostHog adds fails the build until it is added. The same file is served at `/static/array.js`, where PostHog's own snippet looks.

A page that wants no dependency at all loads the site's own file instead — PostHog's surface, name for name, in 20 KB:

```html
<script src="https://example.com/analytics.js"></script>
<script>
  posthog.init('pk_landing_7f3a9c2e51d4', { api_host: 'https://example.com' })
</script>
```

— or keeps PostHog's snippet verbatim and sets `api_host` to this site. The script posts to `<api_host>/api/events` (the host rewrites `/v1/*` to the functions; see [the deploy](/content/docs/building-a-site/dev-build-and-deploy)), sends `$pageview` on load and on a single-page app's route changes (`capture_pageview`), `$pageleave` on leaving (`capture_pageleave`), with `$current_url`, `$host`, `$pathname`, `$referrer`, `$referring_domain`; honours `persistence` (`localStorage` or `memory`), `debug`, `loaded`, `before_send`. An external site identifies its own people with `posthog.identify(id)`, which the rows carry as `distinct_id`; a user of this site is never assumed there.

What the script does not do — feature flags, surveys, session recording, click autocapture, the toolbar, early access — is present with PostHog's names and return shapes: `isFeatureEnabled` answers `false`, `getFeatureFlag` `undefined`, `getAllFeatureFlags` `{}`, `getSurveys(cb)` calls back with `[]`, `sessionRecordingStarted` `false`, `get_session_replay_url` `null`; nothing throws. A page that relies on a flag being _on_ will see it off.

On the dashboard, the **Source** select (This site · each source) reads one source's visitors, channels, audience, pages, events and goals; Content analytics stays this site's. `build/analytics-sdk.test.mjs` loads the built file in a headless page against the served door and checks the surface, the size (under 40 KB gzipped), the `$pageview`, the identify, an opted-out page, PostHog's snippet, two contexts of one browser giving one anonymous id, the wire decoder on each encoding, and the official SDK.
