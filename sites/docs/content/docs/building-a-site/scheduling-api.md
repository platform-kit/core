---
title: The Scheduling API, cal.com's
description: A site's sessions served as cal.com's API v2 — event types, slots, bookings, schedules, webhooks — a booking page for cal.com's embed, and the kit's own cal.com client pointed at the site; the guide. The reference lists every route, argument and field.
order: 56.96
sources:
  [
    packages/kit/supabase/functions/scheduling-api,
    packages/kit/supabase/functions/_shared/api/cal,
    packages/kit/supabase/functions/_shared/scheduling-events.ts,
    packages/kit/supabase/functions/_shared/booking.ts,
    packages/kit/supabase/functions/_shared/schedulers/cal.js,
    packages/kit/src/lib/cal-embed.js,
    packages/kit/theme/src/pages/BookPage.vue,
    packages/kit/build/scheduling-api.test.mjs,
  ]
reviewed: 2026-10-21
---

## What it is

A site with the sessions module on serves its booking types, open times and bookings the way **cal.com** serves theirs — cal.com's API v2 at `https://<domain>/api/scheduling/v2/…` (one host rewrite, `/api/scheduling/v2/*` → the `scheduling-api` function, so `api.cal.com` → the site is the whole swap), with cal.com's envelope, versions, error codes and webhook payloads. Anything written against cal.com's API works with the host changed — including the kit's own cal.com client, which is how the loop is closed: `_shared/schedulers/cal.js`, the very code that books on cal.com when a type says so, points at the site with `CAL_API_BASE` and books on the native calendar through this API. cal.com's embed takes an alternate origin, so a booking page at `/book/<slug>` speaks its protocol. The reference — every route, argument, field and error — is [The Scheduling API reference](/content/docs/reference/scheduling-api).

```sh
curl 'https://northlight.example.com/v2/slots?eventTypeSlug=intro-call&start=2026-10-01&end=2026-10-07&timeZone=Europe/Amsterdam' -H 'Authorization: Bearer <a scheduling key>' -H 'cal-api-version: 2024-09-04'
curl 'https://northlight.example.com/v2/bookings' -H 'Authorization: Bearer <a scheduling key>' -H 'cal-api-version: 2024-08-13' -H 'content-type: application/json' \
  -d '{"start":"2026-10-01T09:00:00Z","eventTypeSlug":"intro-call","attendee":{"name":"Jane","email":"jane@example.com","timeZone":"Europe/Amsterdam"}}'
```

## Who may ask

A key of kind **Scheduling** (Settings → API) is the site's authority: every type, every booking, the hosts' hours, the webhooks. A signed-in person's JWT is their own: the types their plan admits, their own bookings, a booking for themselves; never the webhooks. Never no one. A key of another kind is `FORBIDDEN`.

## The judge holds

A booking through the API is judged exactly as one from the app (`judge()` in `_shared/sessions.ts`): the attendee is the account with that address; a guest — no account — is admitted only by a type whose `requires` is `anyone` or `guest` and that sells nothing; the plan's tier and the type's allowance (a week's, a month's) apply; a paid type needs a credit already on the account. A refusal answers 403 (402 for `unpaid`) in cal.com's error shape with the judge's code in `details.code` — `guest`, `not-included`, `over`, `unpaid` — and nothing is made; a time just taken is 409. What is made is the same row the app would have made (`makeBooking` in `_shared/booking.ts`): the Coaching tab shows it at once, the host's time is taken, the site's emails and reminders go, a paid session's credit is spent and coaching chat opens with that session's coach until a week after the session ends. This window is derived from the booking, follows a reschedule and closes on cancellation; it is not a membership entitlement.

## The shapes

An **event type** is a session type as cal.com describes one: `id` a stable positive integer from the slug (cal.com's ids are integers and its clients type them so), `slug`, `title`, `lengthInMinutes`, `locations` from where the session happens (a room on the site as `cal-video`, a link, an address, a phone), `minimumBookingNotice`, the buffers, `seatsPerTimeSlot` for a group type, `price` from the offer, the hosts as `users`, and the site's own rules — `requires`, `below`, `weekly`, `monthly`, `scheduler` — under `metadata`; `_links.book` is the booking page. **Slots** (`2024-09-04`) are the open times by day, from whoever schedules the type — the hosts' hours less their bookings, or cal.com's. Where a host has set no hours of their own, a native type falls back to the hours **its own file declares** (`hours`), so a site deployed from its folder serves open times on the first day instead of an empty calendar; the moment the host sets theirs, theirs is the only answer. A **booking** (`2024-08-13`) is a row as cal.com shapes one: `uid`, `status` in cal.com's words (an ended session is `accepted`), `start`, `end`, `duration`, `hosts`, `attendees`, `eventType`, `meetingUrl`, `location`, `metadata`, `bookingFieldsResponses`. A **schedule** (`2024-06-11`) is a host's hours — `availability` by weekday and `overrides` by date — read-only; hours are set in the app. `GET /v2/me` says who asks.

## Webhooks

`POST /v2/webhooks` with `{ subscriberUrl, triggers, active, secret, eventTypeId? }` subscribes; `GET`, `PATCH` and `DELETE /v2/webhooks/{id}` manage one. Every booking the site knows is delivered — a native booking's `BOOKING_CREATED`, `BOOKING_RESCHEDULED` and `BOOKING_CANCELLED` from `_shared/booking.ts`, a room's `MEETING_STARTED` and `MEETING_ENDED` from the call, and a cal.com-scheduled type's events re-emitted as `cal-webhook` receives them — as cal.com's payload (`triggerEvent`, `createdAt`, `payload { type, title, startTime, endTime, organizer, attendees, uid, bookingId, eventTypeId, status, metadata, responses, … }`), signed `X-Cal-Signature-256` (HMAC-SHA256 hex of the raw body, keyed by the subscription's secret). The payload is the one the kit's own `cal-webhook` reads, so one site's subscriber may be another site's `cal-webhook`. A failed delivery is kept on the subscription and tried again on the next event.

## cal.com's embed

The booking page at `/book/<slug>` is the booker the Coaching tab shows, on its own with no site chrome, the site's sign-in where the person has none (every booking is an account's). Opened by cal.com's embed (`?embed=<namespace>&embedType=…&theme=…`) it speaks the embed's messages (`__iframeReady`, `__dimensionChanged`, `linkReady`, `bookingSuccessfulV2`, `rescheduleBookingSuccessfulV2`, `bookingCancelled`; `lib/cal-embed.js`), so cal.com's own library shows the site's booker on an outside page and its callbacks fire:

```html
<div id="my-cal"></div>
<!-- cal.com's own loader snippet, as its embed docs give it (it loads https://app.cal.com/embed/embed.js) -->
<script>
  Cal('init', { origin: 'https://northlight.example.com' })
  Cal('inline', { elementOrSelector: '#my-cal', calLink: 'book/intro-call' })
  Cal('on', { action: 'bookingSuccessfulV2', callback: (e) => console.log(e.detail.data.uid) })
</script>
```

The embed opens `<origin>/book/<slug>/embed?embed=…` in its frame; the page answers there as at `/book/<slug>`.

The modal and the floating button work the same way (`Cal("modal", …)`, `Cal("floatingButton", …)`). cal.com's atoms (`@calcom/atoms`) are not the target: they need cal.com's OAuth clients and managed users; the embed does not.

## The closed loop

`cal.js` reads `CAL_API_BASE` (default `https://api.cal.com/v2`). Set to a site's `/v2`, the kit's cal.com client — `eventTypes`, `slots`, `book`, `reschedule`, `cancel` — talks to that site's Scheduling API, which is what `build/scheduling-api.test.mjs` does against the site itself: the same client that would book on cal.com books on the native calendar, and every answer is a shape it already reads.

## What checks it

`build/scheduling-api.test.mjs` (in `platformkit test` with sessions and api on; `SCHEDULING_API_TEST=0` skips it) pins the shapes under Node against cal.com's published v2 responses and — with the stack up and a native type hosted by the seeded coach, the demo's — runs the closed loop, the judge's four refusals, a person's JWT, the webhooks with a local receiver verifying `X-Cal-Signature-256`, the schedule, and cal.com's embed on a page of another origin under Playwright (the person signing in inside the frame, booking a time, `bookingSuccessfulV2` on the parent). `deploy-checks` notes the `/api/scheduling/v2/*` rewrite; where the host has none, the site's shell forwards `/v2/…` to the function as it does `/v1/…`.

## What is not there, on purpose

cal.com's OAuth clients, managed users and `@calcom/atoms`; teams, routing forms, workflows, recurring bookings, seated bookings beyond a group type's seats; payments through the API (a paid type needs a credit already on the account — the app's checkout is where it is bought); writing event types or schedules (`405`); cal.com's `/<username>/<slug>` links (the link is `book/<slug>`).
