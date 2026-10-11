# scheduling-api

## Purpose

A site's sessions served as cal.com's API v2 — event types, slots, bookings under the site's own judge, schedules, webhooks — under a scheduling key or a reader's JWT, with cal.com's embed pointed at the site, so anything written against cal.com works with the host swapped.

## Requirements

### Requirement: The sessions are cal.com's API v2

A site with the `sessions` and `api` modules on SHALL serve its session types, open times and bookings as cal.com's API v2 at `https://<domain>/v2/…` (a host rewrite `/v2/*` → the `scheduling-api` function, which `deploy-checks` notes; the function's own address answering too) so that anything written against `https://api.cal.com/v2` works with the host changed — the kit's own `cal.js` scheduler included. A caller SHALL be a key of kind `scheduling` made in Settings → API (the site's: every type, every booking, the hosts' schedules) or a signed-in reader's JWT (their own bookings, the types their tier admits); never no one. **Event types**: `GET /v2/event-types` (`?username`, `?eventSlug`) and `GET /v2/event-types/{id}` — each session type as cal.com's (`id` a stable integer from the slug, `slug`, `title`, `description`, `lengthInMinutes` and `lengthInMinutesOptions`, `locations[]` from where it happens, `seatsPerTimeSlot` for a group type, `minimumBookingNotice`, `beforeEventBuffer` and `afterEventBuffer`, `slotInterval`, `offsetStart`, `bookingWindow`, `bookingLimitsCount`, `bookingLimitsDuration`, `slotInterval`, `offsetStart`, `bookingWindow`, `bookingLimitsCount`, `bookingLimitsDuration`, `onlyShowFirstAvailableSlot`, `confirmationPolicy`, `recurrence`, `seats`, `bookingFields[]`, `schedulingType` and `hosts[]` where more than one host gives it, `price` and `currency` for a paid type, `metadata.requires`). **Slots**: `GET /v2/slots` (`eventTypeId` or `eventTypeSlug`, `start`, `end`, `timeZone`, `format`, `duration` where the type offers several; `cal-api-version: 2024-09-04`) answering `{ '<day>': [{ start }] }` (or `range` with `end`) from whoever schedules the type. **Bookings** (`2024-08-13`): `POST /v2/bookings` (`start`, `eventTypeId` or `eventTypeSlug`, `attendee { name, email, timeZone, language, phoneNumber }`, `guests`, `metadata`, `lengthInMinutes`, `bookingFieldsResponses`), `GET /v2/bookings` (`status` upcoming|past|cancelled|recurring|unconfirmed, `attendeeEmail`, `eventTypeId`, `afterStart`, `beforeEnd`, `sortStart`, `take`, `skip`), `GET /v2/bookings/{uid}`, `POST /v2/bookings/{uid}/reschedule` (`start`, `reschedulingReason`), `POST /v2/bookings/{uid}/cancel` (`cancellationReason`), `POST /v2/bookings/{uid}/confirm` and `POST /v2/bookings/{uid}/decline` (the booking's host or an administrator) — each answering cal.com's booking (`id`, `uid`, `title`, `status`, `start`, `end`, `duration`, `eventTypeId`, `eventType { id, slug }`, `hosts[]`, `attendees[]`, `guests`, `meetingUrl`, `location`, `createdAt`, `metadata`, `bookingFieldsResponses`). **Schedules**: `GET /v2/schedules` (a key: every host's; a JWT: the host's own) answering every set of hours each host keeps as cal.com's schedule (`id`, `name`, `timeZone`, `availability[] { days, startTime, endTime }`, `overrides[] { date, startTime, endTime }`, `isDefault`), and `GET /v2/schedules/{id}` answering one. **Me**: `GET /v2/me`. The envelope SHALL be cal.com's — `{ status: 'success', data }`; `{ status: 'error', error: { code, message, details } }` — with 400 for a malformed request, 401 for no caller, 403 for a refusal, 404 for an unknown type or booking, 409 for a taken time. Writes to event types and schedules SHALL answer 405.

#### Scenario: cal.com's own client, pointed at the site

- **WHEN** a client written against cal.com's API v2 has its base url changed to the site's and
  reads the event types, asks for slots, books, moves and cancels
- **THEN** every call answers in cal.com's shapes and the bookings are the site's own rows, judged
  by the same judge the app's booker asks

Verified by: `build/scheduling-api.test.mjs` against the served function with the kit's `cal.js`

#### Scenario: the site's own client, pointed at the site

- **WHEN** `cal.js` is made with its base set to `<domain>/v2` and a scheduling key, and asked for the seeded native type's slots, a booking for the seeded member at an open time, its reschedule and its cancellation
- **THEN** the slots are the native scheduler's (the coach's hours less bookings, as `scheduling.test.mjs` pins them), the booking is a `bookings` row with `provider: native` that the Coaching tab shows, the move and the cancellation land on the row with the site's emails sent, and every answer is in cal.com's envelope with the shapes `cal.js` already reads

Verified by: `build/scheduling-api.test.mjs` on the demo against the served function; the shapes against cal.com's published v2 responses field for field

#### Scenario: the judge holds through the API

- **WHEN** a booking is posted under a scheduling key for an attendee whose account's tier the type does not admit, for one over their week's allowance, for a paid type with no credit on the account, and for a guest address on a type that admits guests
- **THEN** the first three answer 403 (402 for `unpaid`) with the judge's code (`not-included`, `over`, `unpaid`) in cal.com's error shape and no row is made; the guest booking is made with the address and no account, as the app would make it — and on a members' type a guest address is refused 403 `guest`

Verified by: the test with the seeded accounts — each refusal exercised where the site's types allow it to be provoked, and said when they do not (the demo's paid type is included in the plan; its type allows more than one a week; it has no type that admits guests, so the guest refusal is the one run)

#### Scenario: a reader's JWT

- **WHEN** a signed-in member calls `GET /v2/bookings` and `GET /v2/slots` for a type their tier admits, and for one it does not
- **THEN** they see their own bookings only, the admitted type's times, and 403 for the other; a scheduling key sees every booking

Verified by: the test

### Requirement: Webhooks deliver cal.com's payloads for every booking

The API SHALL take webhook subscriptions as cal.com does — `POST /v2/webhooks` (`subscriberUrl`, `triggers[]` of `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED`, `MEETING_STARTED`, `MEETING_ENDED`, `BOOKING_NO_SHOW_UPDATED`, `active`, `secret`, `payloadTemplate`), `GET /v2/webhooks`, `GET/PATCH/DELETE /v2/webhooks/{id}` — kept as rows of `scheduling_webhooks` (administrators read under RLS; the API writes), and SHALL deliver cal.com's payload (`triggerEvent`, `createdAt`, `payload { type, title, startTime, endTime, organizer, attendees[], uid, bookingId, eventTypeId, status, metadata, responses, cancellationReason, rescheduleUid }`) signed `X-Cal-Signature-256` (HMAC-SHA256 hex of the raw body, the row's secret) for every booking the site knows — a native booking's events from `_shared/booking.ts` and the room's start and end, and a cal.com-scheduled booking's events re-emitted as `cal-webhook` receives them — once per subscription, a failure kept on the row and retried on the next event.

#### Scenario: a native booking reaches a subscriber

- **WHEN** a subscription for `BOOKING_CREATED` and `BOOKING_CANCELLED` is posted, a native booking is made in the app and then cancelled, and the receiver checks the signature
- **THEN** the receiver has two payloads in cal.com's shape (the `uid`, `startTime`, `attendees`, `organizer` those of the row), each verified, and `GET /v2/webhooks/{id}` shows the subscription; after `DELETE` nothing more arrives

Verified by: the test with a local receiver — the same receiver the kit's `cal-webhook` is tested with, so the payload is one cal.com's own consumer accepts

### Requirement: cal.com's embed points at the site

A booking page SHALL exist at `/book/<slug>` (sessions on): the booker as the Coaching tab shows it, no site chrome, the site's sign-in where the type needs one; and, opened by cal.com's embed (`?embed=<namespace>&embedType=inline|modal|floatingButton&theme&layout`), it SHALL speak the embed's messages to its parent — `__iframeReady`, `__dimensionChanged` on every size change, `linkReady`, `bookingSuccessfulV2`, `rescheduleBookingSuccessfulV2`, `bookingCancelled`, `__routeChanged` — so `Cal("init", { origin })` with `Cal("inline" | "modal" | "floatingButton", { calLink: "book/<slug>" })` shows the site's booker on an outside page, sized as cal.com's would be, and the parent's `Cal("on", { action: "bookingSuccessfulV2" })` fires with the booking's `uid`, `title`, `startTime`, `endTime`, `eventTypeId`, `status`.

#### Scenario: the inline embed on another origin

- **WHEN** a page on another local port runs `Cal("init", { origin: "http://localhost:5173" })` and `Cal("inline", { elementOrSelector, calLink: "book/<slug>" })`, and a reader signs in inside the frame (every booking is an account's) and books a time
- **THEN** the booker appears inline at the height it reports, `bookingSuccessfulV2` fires on the parent with the new booking's uid, and `GET /v2/bookings/{uid}` answers it

Verified by: the test on Playwright with `@calcom/embed-core`; screenshots of the page at 1280 and 390, both themes, and of the embed

### Requirement: Everything a booking type gains is visible in cal.com's own shapes

A client written against cal.com SHALL see the new behaviour without being taught anything, so every
setting a type gains SHALL be carried under the name cal.com uses for it.

**Assignment**: `schedulingType` of `COLLECTIVE`, `ROUND_ROBIN` or `MANAGED`, absent where one person
gives it; `hosts[] { userId, mandatory, priority, weight }` with `mandatory` marking a fixed host and
`priority` one of cal.com's five levels; `assignAllTeamMembers`; and the reschedule rules
(`rescheduleWithSameRoundRobinHost`, `allowRRHostChoiceOnReschedule`).

**Availability**: `scheduleId`. `GET /v2/schedules` SHALL answer **every** set of hours a host keeps,
each with its name and `isDefault`; `GET /v2/schedules/{id}` SHALL answer one; and a host's away
entries SHALL be readable and writable as cal.com's out-of-office shape.

**Limits**: `beforeEventBuffer`, `afterEventBuffer`, `minimumBookingNotice`, `slotInterval`,
`offsetStart`, `bookingLimitsCount`, `bookingLimitsDuration`, `onlyShowFirstAvailableSlot`,
`bookerActiveBookingsLimit`, and `bookingWindow` as cal.com's three kinds — `businessDays`,
`calendarDays` (each with a value and whether it rolls) and `range` (two dates).

**Advanced and Setup**: `bookingFields[]` in cal.com's kinds, both the system fields and the custom
ones; `confirmationPolicy` (`always` or `time` with its `noticeThreshold`, and whether an
unconfirmed booking blocks the slot); `seats { seatsPerTimeSlot, showAttendeeInfo,
showAvailabilityCount }`; `recurrence { interval, occurrences, frequency }`;
`lengthInMinutesOptions`; `customName`; `successRedirectUrl`; `hideCalendarNotes`,
`hideCalendarEventDetails`, `hideOrganizerEmail`; `lockTimeZoneToggleOnBookingPage`;
`disableCancelling` and `disableRescheduling`; `bookingRequiresAuthentication`; `hidden`.

**Bookings**: a held booking SHALL read `status: 'pending'` and appear under
`GET /v2/bookings?status=unconfirmed`; `POST /v2/bookings/{uid}/confirm` and `/decline` SHALL be
taken from the booking's host or an administrator; a run of recurring bookings SHALL be created by
one call and read under `status=recurring`; and `bookingFieldsResponses` SHALL be both accepted and
answered.

Slots SHALL honour every one of those rules, so what the API offers and what the site's own booker
offers are the same times, computed once.

#### Scenario: a client reads a round-robin type and books against it

- **WHEN** a client reads a team's round-robin event type with a fixed host and two rotating hosts of
  different weights, asks for slots and books one
- **THEN** the type carries `schedulingType: ROUND_ROBIN` and all three hosts with their `mandatory`,
  `priority` and `weight`; the slots are the times the fixed host and at least one rotating host are
  free; and the booking names the hosts it was assigned

Verified by: `build/scheduling-api.test.mjs` against the served function, and the kit's own `cal.js`
pointed at the site

#### Scenario: every schedule, not one

- **WHEN** a host keeps two named sets of hours and a scheduling key reads the schedules
- **THEN** both come back, each with its name and its own overrides, one marked `isDefault`

Verified by: `build/scheduling-api.test.mjs`

#### Scenario: held, confirmed and declined through the API

- **WHEN** a booking is made on a type that waits, then confirmed; and a second is declined
- **THEN** the first reads `pending` and appears under `status=unconfirmed` until it is confirmed,
  the second is freed and its time offered again, and both refuse a caller who is neither the host
  nor an administrator

Verified by: `build/scheduling-api.test.mjs`

#### Scenario: the API's times are the booker's times

- **WHEN** the same type's slots are asked for through the API and shown in the site's own booker for
  one week, with a limit and a window in force
- **THEN** they are the same times

Verified by: `build/scheduling-api.test.mjs` comparing both answers
