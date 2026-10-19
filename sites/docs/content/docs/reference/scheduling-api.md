---
title: The Scheduling API reference
description: Every route, argument, field, header and error of the cal.com-compatible Scheduling API a site serves — the reference; the guide is under Building a site.
order: 85.6
sources:
  [
    packages/kit/supabase/functions/scheduling-api/index.ts,
    packages/kit/supabase/functions/_shared/api/cal,
    packages/kit/supabase/functions/_shared/scheduling-events.ts,
    packages/kit/supabase/functions/_shared/api/keys.ts,
    packages/kit/supabase/schemas/55-sessions.sql,
    packages/kit/build/scheduling-api.test.mjs,
  ]
reviewed: 2026-10-19
---

The guide is [The Scheduling API, cal.com's](/content/docs/building-a-site/scheduling-api). This page says exactly what is there.

A subscription carries a **source**: one somebody made through this API is `hand` and is theirs, and one a deployment ships declared in `platformkit.config.js` is `file` and is the projection's to replace — see [Declarations and state](/content/docs/building-a-site/declarations-and-state).

## Base, callers, headers

|                   |                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| base              | `https://<domain>/api/scheduling/v2` (the host rewrites `/api/scheduling/v2/*` to the `scheduling-api` function; the function's own address `https://<ref>.supabase.co/functions/v1/scheduling-api/v2/…` answers too) |
| a key             | `Authorization: Bearer <key>` or `?access_token=`; a key of kind `scheduling` — every type, every booking, the hosts' hours, the webhooks                                                                             |
| somebody          | `Authorization: Bearer <JWT>` — their own bookings, the types their plan admits, a booking for themselves; no webhooks; an administrator's JWT reads as a key does but for the webhooks                               |
| `cal-api-version` | taken where cal.com asks it (`2024-06-14` event types, `2024-09-04` slots, `2024-08-13` bookings, `2024-06-11` schedules); never required                                                                             |
| envelope          | `{ status: 'success', data }`; `{ status: 'error', error: { code, message, details? } }`                                                                                                                              |
| headers           | `Content-Type: application/json`; the api module's rate-limit headers; `Retry-After` on 429                                                                                                                           |
| CORS              | open (`*`)                                                                                                                                                                                                            |
| module            | `sessions` and `api` both on                                                                                                                                                                                          |

## Routes

| Route                                            | Answers                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/me`                                     | `{ id, username, email, name, timeFormat, defaultScheduleId, weekStart, timeZone, organizationId, organization }`                                                                                                                                                       |
| `GET /v2/event-types`                            | `[event type]` — the caller's; `?username=<a host>`, `?eventSlug=<slug>`                                                                                                                                                                                                |
| `GET /v2/event-types/{id}`                       | one, by id or slug                                                                                                                                                                                                                                                      |
| `GET /v2/slots`                                  | `eventTypeId` or `eventTypeSlug`, `start`, `end` (dates), `timeZone`, `format=range` → `{ '<day>': [{ start, end? }] }`                                                                                                                                                 |
| `GET /v2/bookings`                               | `status` (`upcoming`, `past`, `cancelled`, `unconfirmed`, `recurring` — none), `attendeeEmail`, `eventTypeId`, `eventTypeSlug`, `afterStart`, `beforeEnd`, `sortStart` (`asc`, `desc`), `take` (1–250, 100), `skip` → `[booking]`                                       |
| `POST /v2/bookings`                              | `{ start, eventTypeId \| eventTypeSlug, attendee: { name, email, timeZone, language, phoneNumber }, guests, metadata, bookingFieldsResponses: { notes, attendeePhoneNumber } }` → 201 the booking                                                                       |
| `GET /v2/bookings/{uid}`                         | one                                                                                                                                                                                                                                                                     |
| `POST /v2/bookings/{uid}/reschedule`             | `{ start, reschedulingReason?, rescheduledBy? }` → the booking (a native move keeps the uid)                                                                                                                                                                            |
| `POST /v2/bookings/{uid}/cancel`                 | `{ cancellationReason? }` → the booking, `status: 'cancelled'`                                                                                                                                                                                                          |
| `POST /v2/bookings/{uid}/confirm`, `.../decline` | the host's word on one that waits for it — its host or an administrator, and only while it is `pending`. Confirming is the booking being made (the invitation, the room, the week of chat); declining frees the time, tells the person and leaves a paid credit unspent |
| `GET /v2/schedules`, `GET /v2/schedules/{id}`    | every SET of hours a host keeps, one marked `isDefault` (a key: every host's; somebody: their own)                                                                                                                                                                      |
| `GET /v2/ooo`                                    | the stretches somebody is away and who covers them — `{ id, userId, start, end, notes, reason: { emoji, reason }, toUser }`, `toUser` null where nobody covers                                                                                                          |
| writes to days away                              | 405 — they are set in the app (Coaching → When you are away)                                                                                                                                                                                                            |
| `GET /v2/webhooks`, `POST /v2/webhooks`          | a key alone; `{ subscriberUrl, triggers[], active?, secret?, payloadTemplate?, eventTypeId? }` → 201                                                                                                                                                                    |
| `GET`, `PATCH`, `DELETE /v2/webhooks/{id}`       | by the integer id or the row's uuid                                                                                                                                                                                                                                     |
| writes to event types or schedules               | 405                                                                                                                                                                                                                                                                     |

## An event type

`{ id (a stable positive integer from the slug: FNV-1a, 31 bits), ownerId, lengthInMinutes, lengthInMinutesOptions (every length it offers, the default first), title, slug, description, locations: [{ type: 'integration', integration: 'cal-video' } | { type: 'link', link } | { type: 'address', address } | { type: 'phone', phone } | { type: 'attendeePhone' }], bookingFields (cal.com's own, then the type's form — each `{ type, slug, label, required, options? }`), disableGuests, slotInterval, offsetStart, minimumBookingNotice (minutes), beforeEventBuffer, afterEventBuffer, recurrence (a run the person books: `{ interval, occurrences, frequency }`, else null), metadata: { requires, below, weekly, monthly, scheduler, sku, record, team, form, customName }, price, currency, lockTimeZoneToggleOnBookingPage, hideCalendarNotes, hideCalendarEventDetails, hideOrganizerEmail, successRedirectUrl, forwardParamsSuccessRedirect, hidden, requiresBookerEmailVerification, disableCancelling, disableRescheduling, allowReschedulingPastBookings, seatsPerTimeSlot, seatsShowAvailabilityCount, seats: { seatsPerTimeSlot, showAvailabilityCount, showAttendeeInfo } | { disabled: true }, scheduleId (the SET of hours it asks its hosts for, by name), requiresConfirmation, confirmationPolicy ({ type: 'disabled' | 'always' | 'time', noticeThreshold? }), customName, users, hosts: [{ userId, name, mandatory, priority: 'lowest'…'highest', scheduleId }], schedulingType: 'ROUND_ROBIN' | 'COLLECTIVE' | 'MANAGED', assignAllTeamMembers, teamId, bookingLimitsCount: { day?, week?, month?, year? }, bookingLimitsDuration: { day?, week? } (minutes), bookingWindow, _links: { book } }`.

One host is a rota with one name in it, so a single-host type answers `ROUND_ROBIN` rather than a fourth word cal.com's clients do not know.

## A booking

`{ id, uid, title, description (the notes), hosts: [{ id, name, email, username, timeZone }], status: 'accepted' | 'pending' | 'rescheduled' | 'cancelled' | 'rejected' (an ended session is accepted), cancellationReason, rescheduledFromUid, start, end, duration, eventTypeId, eventType: { id, slug }, meetingUrl, location, absentHost, createdAt, updatedAt, metadata: { …the booking's, provider, event, seatOf? }, rating, icsUid, attendees: [{ name, email, timeZone, language, absent, phoneNumber? }], guests: [], bookingFieldsResponses: { name, email, notes?, attendeePhoneNumber? } }`.

## A schedule

`{ id, ownerId, name, timeZone, availability: [{ days: ['Monday', …], startTime: 'HH:MM', endTime: 'HH:MM' }], isDefault: true, overrides: [{ date: 'YYYY-MM-DD', startTime, endTime }] (a day off as 00:00–00:00), metadata: { beforeBufferMinutes, afterBufferMinutes, noticeHours, maxPerDay, maxPerWeek } }` — one per SET of hours, from `provider_schedules` and `provider_overrides`. A host keeps any number, each with a `name`, one with `isDefault: true`.

## Webhooks

A **webhook**: `{ id (integer), uid (the row), subscriberUrl, triggers, active, payloadTemplate, eventTypeId, userId, createdAt, updatedAt, lastDeliveredAt, lastError }` — never the secret. The triggers: `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED`, `BOOKING_REJECTED`, `MEETING_STARTED`, `MEETING_ENDED`, `BOOKING_NO_SHOW_UPDATED`, `RECORDING_READY`. The **delivery**: `POST <subscriberUrl>` with `{ triggerEvent, createdAt, payload: { type (the slug), title, description, additionalNotes, customInputs, startTime, endTime, organizer: { id, name, email, username, timeZone, language }, attendees: [{ name, email, timeZone, language }], location, destinationCalendar, uid, bookingId, eventTypeId, eventTitle, status (upper case), metadata, responses, cancellationReason?, rescheduleUid?, videoCallData? } }` under `X-Cal-Signature-256: <HMAC-SHA256 hex of the raw body, keyed by the secret>`. From: a native booking made, moved, cancelled (`_shared/booking.ts`); a room started and ended (`livekit-webhook`, `session-room`); every event `cal-webhook` accepts, re-emitted. Once per event per active subscription whose triggers name it (and whose `eventTypeId`, if set, is the booking's); a failure kept as `lastError` and tried again on the next event. `scheduling_webhooks` in the database: `id`, `subscriber_url`, `triggers text[]`, `active`, `secret`, `payload_template`, `event_type_slug`, `created_by`, `created_at`, `updated_at`, `last_at`, `last_error`; administrators read under RLS, the API writes with the service role.

## The judge

`POST /v2/bookings` resolves the attendee by email to a profile; no profile is a guest, admitted only by a type whose `requires` is `anyone` or `guest` (else 403 `details.code: guest`); then `judge()` — the tier (`not-included`), the allowance (`over`, with `details.next` and `details.allowance`), a paid type's credit (402 `unpaid`); a native type with no host or no length 503; a phone type with no number 400; a time just taken 409 `taken`. Somebody's JWT books for their own address only (403 otherwise). A move by somebody inside the type's notice is 403 `too-soon`.

The API booking route and paid Checkout are distinct paths. When a site permits guest booking, Checkout carries the chosen session and time in its metadata; after payment, fulfillment uses the selected payment provider's returned email as the attendee email and claims the checkout once. The private, service-role-only `booking_checkout_fulfilments` row is keyed by provider-scoped checkout identity and moves from `processing` to `booked`, `unavailable` or `failed`; the successful `bookings` row also stores that identity under a unique index. This makes webhook retries and success-page confirmation idempotent. If the chosen time is no longer available, no booking is created and the claim is marked `unavailable`. A direct `POST /v2/bookings` still follows the judge above and requires the paid type's credit.

## Errors

`{ status: 'error', error: { code, message, details? } }` — `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `PAYMENT_REQUIRED` (402: a paid type with no credit, `details.code: unpaid`), `FORBIDDEN` (403: the judge's `guest`, `not-included`, `over`, `too-soon` in `details.code`; a key of another door; somebody on another's booking), `NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405), `CONFLICT` (409: `details.code: taken`), `TOO_MANY_REQUESTS` (429, `Retry-After`), `INTERNAL_SERVER_ERROR` (500), `BAD_GATEWAY` (502: the scheduler failed), `SERVICE_UNAVAILABLE` (503: a native type with no host or no length).

## The embed's side

`/book/<slug>` (`ROUTES.book`, sessions on) is the booker on its own page. Under `?embed=<namespace>&embedType=inline|modal|floatingButton&theme=light|dark` (`lib/cal-embed.js`) it posts to its parent `{ originator: 'CAL', type, namespace, data, fullType }` with `type` one of `__iframeReady`, `__dimensionChanged` (`iframeHeight`, `iframeWidth`, `isFirstTime`), `linkReady` (the times loaded), `bookingSuccessfulV2` (`uid`, `title`, `startTime`, `endTime`, `eventTypeId`, `status`, `paymentRequired`, `isRecurring`, `videoCallUrl?`), `rescheduleBookingSuccessfulV2`, `bookingCancelled`, `__routeChanged`; `theme` is honoured as the page's theme.
