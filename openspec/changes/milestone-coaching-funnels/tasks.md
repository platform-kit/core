# Tasks

## 1. Prove scheduling evidence

- [ ] 1.1 Exercise real Cal.com test-mode single-host, round-robin with a fixed organizer, and collective bookings through completion; document the authoritative assignment, organizer, booking-type, no-show and completion evidence and verify it against the documented API.
- [ ] 1.2 Normalize native and Cal.com booking evidence without guessing and preserve it across retries and rescheduling; verify `packages/kit/modules/funnels/tests/milestone-schedulers.test.mts` and the real booking cases.

## 2. Define and capture milestones

- [ ] 2.1 Extend the funnel grammar, compiler and validation for booking types, course/section/lesson triggers, sender authorization and milestone-relative message steps without changing existing channels; verify `packages/kit/modules/funnels/tests/milestone-funnels.test.mts`.
- [ ] 2.2 Record session and course milestone occurrences, including section completion and per-attendee identities, with module-safe integration and explicit schema grants; verify `packages/kit/modules/funnels/tests/milestone-funnels-db.test.mts` and `packages/kit/build/declarations.test.mts`.
- [ ] 2.3 Enforce coach and administrator authorization for authoring, reading and sending, including assigned coaches of shared booking types; verify allowed and forbidden cases in `packages/kit/modules/funnels/tests/milestone-funnels-db.test.mts`.

## 3. Deliver and inspect

- [ ] 3.1 Implement the durable five-minute scheduler, milestone-relative delays, cancellation checks, snapshot semantics, retry and atomic deduplication; verify timing, failure, pause and concurrent workers in `packages/kit/modules/funnels/tests/milestone-funnels-db.test.mts`.
- [ ] 3.2 Deliver visibly automated messages to the right coaching conversations and preserve existing unread and notification behavior; verify sender, recipient and message identity in `packages/kit/modules/funnels/tests/milestone-funnels-db.test.mts` and a rendered coaching conversation.
- [ ] 3.3 Add funnel authoring, preview and delivery status controls with editable UI strings; verify saved definitions, errors, permissions and rendered states at 1280 and 390 px in light and dark themes.

## 4. Document and verify

- [ ] 4.1 Update `sites/docs/content/docs/running-a-site/marketing/funnels-and-blasts.md` and `sites/docs/content/docs/building-a-site/emails-and-funnels-internals.md`, including sources and external-booking prerequisites; verify with `packages/kit/build/docs-check.mts`.
- [ ] 4.2 Verify every named scenario, module-off behavior, applicable access and data declarations, and existing funnel and support-prompt behavior; report each scenario passed, failed or not verified with reasons, including real Cal.com and browser checks.