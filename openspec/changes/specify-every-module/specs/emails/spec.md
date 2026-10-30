## ADDED Requirements

### Requirement: The site's emails are designed in the admin

The `emails` module SHALL let staff design each email the site sends in a drag-and-drop editor, with merge fields, sections repeated per order line, sections shown on a condition, and a subject per email. The designs SHALL be compiled at build time and read by the send function. An administrator SHALL be able to send a test filled with sample details.

#### Scenario: a design compiles

- **WHEN** the site's designs are compiled
- **THEN** every email the site sends has a compiled design, and a missing one fails the build naming it

Verified by: no test yet

### Requirement: Every email is about something the reader did

The site SHALL send the store's (confirmation, files ready, shipped), the account's (confirm, sign in, reset), coaching's, sessions', support's, events' and providers' emails. Each SHALL be filled with the order, booking, conversation or account it is about, and sent through the site's own mail provider.

#### Scenario: an order confirmation

- **WHEN** an order is paid
- **THEN** its buyer is sent one confirmation naming its lines and total

Verified by: no test yet

### Requirement: Every send is logged

Every email sent SHALL be logged with its recipient, its kind and its links, and an open or a click SHALL be recorded against that log.

#### Scenario: a tracked click

- **WHEN** a reader clicks a tracked link in an email
- **THEN** the click is recorded against that send and they reach the link's address

Verified by: no test yet
