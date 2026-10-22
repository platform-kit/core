## Purpose

The guarantees that protect a site's money, its customers' records and its staff roles, each proven by a test rather than assumed from the interface.

## ADDED Requirements

### Requirement: The server decides what a buyer pays

What a buyer pays SHALL be worked out on the server from the site's own offers, price lists, promotions and shipping rates. A checkout request SHALL NOT be able to set or change a price, a discount, a promotion's eligibility, a quantity beyond what the offer allows, a shipping rate, or the currency, and a request that tries SHALL be charged the server's amount or refused.

#### Scenario: a tampered checkout

- **WHEN** a checkout request carries a changed price, an extra discount, a promotion the cart doesn't qualify for, a quantity above the offer's limit, a cheaper shipping method than the destination allows, or another currency
- **THEN** the checkout is created at the server's amount, or refused, and never at the requested one

Verified by: `node build/checkout-tamper.test.mjs` against the local stack

### Requirement: An account reaches only its own records

Every function and database read that returns or changes a customer's record SHALL check that the signed-in account owns it, or holds a staff role that may see it, before returning anything. This covers orders, bookings, tickets and their timelines, purchased files, session recordings and transcripts, invoices, payout accounts, earnings and usage. A request for another account's record SHALL be answered as if it did not exist.

#### Scenario: another account's id

- **WHEN** a signed-in reader asks for another reader's order, booking, ticket, file, recording, transcript, invoice, payout account, earnings or usage by its id
- **THEN** each request is refused with no data, the same way as for an id that doesn't exist

Verified by: `node build/ownership.test.mjs` against the local stack, covering every such function and table

#### Scenario: staff within their role

- **WHEN** a support agent, a provider and an analyst ask for records outside their role
- **THEN** each sees only what their role allows

Verified by: `node build/ownership.test.mjs`

### Requirement: Roles are granted only by administrators

A staff role SHALL be granted or removed only by an administrator, and no account SHALL be able to give itself a role, raise its own class, or remove the last administrator, whichever way the request is made.

#### Scenario: self-promotion

- **WHEN** a reader, an editor and a provider each try to grant themselves a role or a paying class through every path that writes roles or entitlements
- **THEN** every attempt is refused and nothing changes

Verified by: `node build/roles.test.mjs` against the local stack

#### Scenario: the last administrator

- **WHEN** the only administrator's role is removed, by themselves or by the database directly through the role functions
- **THEN** the removal is refused

Verified by: `node build/roles.test.mjs`

### Requirement: Incoming notifications are verified before they are read

Every webhook the site receives — from the payment provider, cal.com, social platforms, and any other sender — SHALL verify the sender's signature over the exact bytes received before reading the body, SHALL refuse an event older than the sender's tolerance, and SHALL change nothing when refused.

#### Scenario: forged, altered and replayed events

- **WHEN** each webhook receives an unsigned body, a body signed with the wrong secret, a correctly signed body altered by one byte, and a correctly signed event older than the tolerance
- **THEN** each is refused and no record changes

Verified by: `node build/webhook-doors.test.mjs`, extended to every inbound webhook

### Requirement: Links to private files are short-lived and personal

A link to a purchased file, a recording or a transcript SHALL be issued only to an account allowed to read it and SHALL expire within an hour. A link issued to a printer for a print job SHALL expire no later than the job needs it.

#### Scenario: link lifetimes

- **WHEN** a buyer, a booking's attendee and a printer job each receive a link
- **THEN** the buyer's and attendee's links expire within an hour, the printer's within its job's window, and no link is issued to anyone else

Verified by: `node build/ownership.test.mjs` (link lifetimes)

### Requirement: Public doors have abuse limits

Guest checkout, sign-up, the support widget, form responses and analytics intake SHALL each limit how much one visitor can send in a period, and SHALL refuse requests over the limit without affecting other visitors.

#### Scenario: a flood from one visitor

- **WHEN** one visitor sends many requests to each public door in quick succession
- **THEN** requests over the limit are refused, and another visitor's request still succeeds

Verified by: `node build/abuse-limits.test.mjs` against the local stack

### Requirement: No server secret reaches the browser

No server-side secret SHALL be included in any file a site publishes. Only keys meant to be public (the anonymous database key, publishable payment keys and the push public key) MAY appear there.

#### Scenario: a built site with known secrets

- **WHEN** the demo is built with a distinctive value in every server-side secret
- **THEN** none of those values appears in any published file

Verified by: `node build/bundle-secrets.test.mjs`
