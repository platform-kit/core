# Milestone coaching funnels

## Purpose

Coaches can follow up on a client's completed session or course progress with a sequence of relevant coaching messages.

## ADDED Requirements

### Requirement: Authors can configure milestone coaching sequences

An authorized coach SHALL be able to create, edit, publish, pause, and preview a coaching-message funnel. It SHALL select one or more booking types for a completed session, or a specific course and optionally one of its sections or lessons. Its steps SHALL each contain editable message text and a nonnegative delay measured from the milestone, in hours or days. Course-triggered funnels SHALL name an authorized sending coach explicitly. A preview SHALL identify the trigger, sender rule, messages, and delays without sending. The interface SHALL prevent publication of incomplete or unauthorized settings and report why.

#### Scenario: a session sequence is configured

- **WHEN** a coach selects one session type and writes messages for three hours and three days after completion
- **THEN** the preview names the type, both delays and messages, and the assigned-coach-then-sole-organizer sender rule

Verified by: `packages/kit/modules/funnels/tests/milestone-funnels.test.mts` and the editor rendered at 1280 and 390 px in light and dark themes.

#### Scenario: a course sequence needs a sender

- **WHEN** a coach selects a lesson and attempts to publish without an authorized sender
- **THEN** publication is refused with a reason and no coaching message is sent

Verified by: `packages/kit/modules/funnels/tests/milestone-funnels.test.mts` and the editor rendered in its error state at 1280 and 390 px.

### Requirement: Completed bookings start the correct sequence

For each booking of a selected type after a funnel is published, the system SHALL start a separate sequence for each eligible account attendee after its scheduled end. It SHALL exclude cancelled, rejected, rescheduled-away and known no-show bookings. A repeated webhook SHALL NOT start another sequence for the same booking and attendee. The milestone time SHALL be the scheduled end, not the booking start; it SHALL NOT be described as proof of attendance or actual call completion. If the scheduled end cannot be established, the system SHALL hold the sequence and show the reason.

#### Scenario: repeat bookings and webhook retries

- **WHEN** one reader completes two bookings of the selected type and the second completion is reported twice
- **THEN** each booking starts one sequence for the reader, and a different type starts none

Verified by: `packages/kit/modules/funnels/tests/milestone-funnels-db.test.mts`.

#### Scenario: an invalid session

- **WHEN** a booking is cancelled, rescheduled away, or marked no-show before delivery
- **THEN** no pending follow-up for that booking is delivered

Verified by: `packages/kit/modules/funnels/tests/milestone-funnels-db.test.mts`.

### Requirement: Booking sender selection is the same for each scheduler

For native and Cal.com bookings, the system SHALL send as the person assigned to the booking when exactly one assigned person is established. Otherwise, when there is no assigned person and exactly one organizer, it SHALL send as that organizer. A primary host is an organizer and is not by itself proof of individual assignment. If the assigned person or sole organizer cannot be established or mapped to an eligible account, the message SHALL remain undelivered with a visible reason; the system SHALL NOT guess or impersonate another person. A booking type with several possible coaches SHALL use the coach selected for the individual booking.

#### Scenario: assigned coach with multiple organizers

- **WHEN** a native or Cal.com booking has a known assigned coach and several organizers
- **THEN** its follow-ups are sent from that assigned coach, not an arbitrary organizer

Verified by: `packages/kit/modules/funnels/tests/milestone-schedulers.test.mts` and a real Cal.com test booking with a round-robin host and a fixed organizer.

#### Scenario: sole organizer and ambiguous organizers

- **WHEN** neither booking has an assigned coach, one has one organizer and the other has several
- **THEN** the first sends from its organizer and the second is held with a reason

Verified by: `packages/kit/modules/funnels/tests/milestone-schedulers.test.mts` and Cal.com test bookings for single-host and collective types.

### Requirement: Course progress starts the selected sequence

A course milestone SHALL occur when the specified course completes, when the specified lesson completes, or when all required lessons in the specified section complete. A section with no required lessons SHALL NOT complete automatically. The system SHALL use the recorded completion time, start at most one sequence per enrollment and selected milestone, and send from the funnel's selected coach. Completion of a different course, section, or lesson SHALL NOT match.

#### Scenario: section and lesson completion

- **WHEN** a reader finishes one selected lesson and later the last required lesson of its section
- **THEN** the lesson and section sequences each start once at their respective completion times

Verified by: `packages/kit/modules/funnels/tests/milestone-funnels-db.test.mts`.

#### Scenario: course completion and a different course

- **WHEN** a reader completes the selected course and another course
- **THEN** only the selected course starts its course-completion sequence, sent by the configured coach

Verified by: `packages/kit/modules/funnels/tests/milestone-funnels-db.test.mts`.

### Requirement: Delivery is reliable and visible

Each message SHALL be due at its milestone time plus its own delay and SHALL be delivered no earlier, including if previous steps are late. The scheduler SHALL run at least every five minutes; outages SHALL leave messages pending for retry. A recipient SHALL receive each step at most once per milestone, including after concurrent or repeated runs. Messages SHALL enter the coach's existing conversation and identify themselves as automated. Authorized staff SHALL see pending, delivered and failed or held steps and their reasons. Pausing a funnel SHALL hold unsent steps until resumed; editing it SHALL NOT silently rewrite already scheduled messages.

#### Scenario: milestone-relative timing

- **WHEN** a milestone happens at noon and its steps are set for three hours and three days later
- **THEN** they are due at 15:00 that day and noon three days later, independently of when the first is delivered

Verified by: `packages/kit/modules/funnels/tests/milestone-funnels-db.test.mts`.

#### Scenario: retries and concurrent workers

- **WHEN** two workers process the same due message or a delivery is retried after interruption
- **THEN** the coaching conversation contains at most one copy and the delivery state reflects the outcome

Verified by: `packages/kit/modules/funnels/tests/milestone-funnels-db.test.mts`.

#### Scenario: pause and inspect

- **WHEN** an author pauses a sequence before a message is due and opens its delivery view
- **THEN** the message remains pending, its hold is explained, and it can proceed after resuming

Verified by: `packages/kit/modules/funnels/tests/milestone-funnels-db.test.mts` and the delivery view rendered at 1280 and 390 px in light and dark themes.

### Requirement: Access and existing funnels remain safe

Only an administrator or a coach authorized to send as the selected coach SHALL manage or inspect a coaching sequence; the server SHALL enforce this on every write and read. The coaching recipient and sender SHALL be valid participants, and accountless attendees SHALL NOT receive an invented conversation. Sites without the required modules SHALL not expose the corresponding triggers. Existing email sequences, marketing opt-outs and cooldowns, and support prompts SHALL keep their existing behavior.

#### Scenario: unauthorized sender

- **WHEN** a coach attempts to create or alter a sequence that sends as another coach without authorization
- **THEN** the server refuses it and no message is scheduled

Verified by: `packages/kit/modules/funnels/tests/milestone-funnels-db.test.mts`.

#### Scenario: existing funnel and module switches

- **WHEN** existing email and support-prompt funnels run and a required module is disabled
- **THEN** the existing funnels behave as before and unavailable coaching triggers are not offered

Verified by: `packages/kit/modules/funnels/tests/milestone-funnels.test.mts` and `packages/kit/modules/support/tests/support.test.mts`.
