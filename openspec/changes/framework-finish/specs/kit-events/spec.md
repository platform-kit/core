## ADDED Requirements

### Requirement: Modules emit typed events that other modules can listen to

The kit SHALL keep a typed catalogue of events that modules extend. An event SHALL be recorded in the same transaction as the change that caused it, so an event is never lost and never recorded for a change that was rolled back. Every listener a module declares SHALL receive each event at least once, with retries on failure, and an event that fails every attempt SHALL be kept and marked failed. The first catalogue SHALL include an order paid and refunded, a member joined and their tier changed, a booking confirmed and cancelled, a course enrolled in and completed, a form submitted, and a ticket opened.

#### Scenario: a listener receives an event

- **WHEN** a demo module listens to "order paid" and an order is paid
- **THEN** the listener runs with the order's typed payload

Verified by: `build/kit-events-db.test.mts` under `platformkit test --e2e`

#### Scenario: a rolled-back change

- **WHEN** a payment's transaction fails after the event would have been written
- **THEN** no event exists

Verified by: `build/kit-events-db.test.mts`

#### Scenario: a failing listener

- **WHEN** a listener fails every attempt
- **THEN** it is retried with backoff, and the event is kept and marked failed

Verified by: `build/kit-events-db.test.mts`

#### Scenario: a listener's module off

- **WHEN** the listening module is off
- **THEN** its listener is not bundled and receives nothing

Verified by: `build/kit-events-db.test.mts`
