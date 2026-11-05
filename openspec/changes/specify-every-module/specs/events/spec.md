## ADDED Requirements

### Requirement: An event is declared and its dates are made

The `events` module SHALL read events from `content/events/*.md` and project them, with every upcoming date of a repeating event expanded over a rolling year. A repeat SHALL survive daylight saving, and an occurrence somebody is attending, or one cancelled by hand, SHALL survive a rewrite of the event.

#### Scenario: a weekly event across a clock change

- **WHEN** a weekly event's dates are expanded across a daylight-saving change
- **THEN** every occurrence keeps its local time

Verified by: `build/recurrence.test.mts`, `build/events-db.test.mts` under `platformkit test --e2e`

### Requirement: RSVP, capacity and paid registration

A reader SHALL be able to answer going, interested or not going. An event with a capacity SHALL show the spots left and "Full". Paid registration SHALL reveal the address or link only after registering. A single date SHALL be cancellable with a note, and attendees SHALL get a reminder the day before.

#### Scenario: a full event

- **WHEN** an event's capacity is reached
- **THEN** it shows "Full" and takes no further "going"

Verified by: no test yet

### Requirement: Calendar invitations

A booking or a registration SHALL be sent with a calendar invitation, a move SHALL send an update and a cancellation a cancel, and the file SHALL be escaped and folded as the standard requires.

#### Scenario: a moved booking

- **WHEN** a booking is moved
- **THEN** its invitation carries SEQUENCE 1 and the new time

Verified by: `build/ics.test.mts`
