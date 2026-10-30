## ADDED Requirements

### Requirement: A space's membership follows rules

The `spaces` module SHALL hold staff, community and server spaces, each with its own place in the sidebar. A space's membership SHALL follow a rule: all staff, live members or a tier, buyers of a product, anyone with a booking, a custom rule, or invitation only, and a channel MAY be narrower than its space. A sweep SHALL keep the membership true as purchases, tiers and bookings change. A reader who is not a member SHALL see no space, channel or message of it.

#### Scenario: a tier fills a space

- **WHEN** a reader buys the tier a space is filled from
- **THEN** they become a member, and a reader without it sees nothing of the space

Verified by: `build/spaces-db.test.mjs`, `build/community-db.test.mjs` under `platformkit test --e2e`

### Requirement: Joining, inviting and roles

A space SHALL be open, on request, or by approval, with guidelines and entry questions, and moderators SHALL approve requests. Invite links SHALL carry use limits and expiry and SHALL be revocable. Roles SHALL have a name, a colour and a rank, and permissions (voice notes, attachments, moderate, invite, announcements, @here) SHALL be granted to everyone, a role, a tier, buyers or one person, optionally for a number of days.

#### Scenario: a revoked invite

- **WHEN** an invite link is used after it is revoked, expired or used up
- **THEN** it admits nobody

Verified by: `build/community-db.test.mjs` under `platformkit test --e2e`

### Requirement: Channels, messages and threads

A channel SHALL be a chat, a forum or a feed, open, private or archived, grouped under headings. A message SHALL be editable, deletable, pinnable, savable, draftable and schedulable, with mentions of people, roles, everyone and @here, threads, polls, voice notes and attachments within size limits. Unread counts, mention badges and catching up SHALL follow one shared model.

#### Scenario: what is unread

- **WHEN** a member reads part of a channel and is mentioned further down
- **THEN** the unread count and the mention badge are what the shared spaces model computes

Verified by: `build/spaces.test.mjs`

### Requirement: Moderation is logged

A member SHALL be able to report a message with a reason. A moderator SHALL be able to delete it, mute its author for a time, remove them, or dismiss the report, and every action SHALL be logged. A removed or banned member SHALL lose access to the space at once.

#### Scenario: a ban

- **WHEN** a moderator bans a member
- **THEN** the member can no longer read or post in the space

Verified by: `build/ban-db.test.mjs` under `platformkit test --e2e`

### Requirement: The site writes into operations rooms

The site SHALL post its own events into operations rooms as the database's own messages, not through an integration: purchases, new memberships, failed print orders, new accounts and escalated support.

#### Scenario: a purchase

- **WHEN** a purchase is recorded on a site with an operations room for purchases
- **THEN** a message about it appears in that room

Verified by: no test yet

### Requirement: The member card

A member card SHALL show what the space calls the person, their join date, message count and bio. It SHALL also show private panels, visible only to the person and to staff, of what they are working on, have read and have bought, each while its module is on. A site SHALL be able to reword, reorder or drop the panels and add its own. A panel's reading SHALL answer nothing to anybody who may not see that member.

#### Scenario: a stranger asks for a member's purchases

- **WHEN** a signed-in reader who is neither the member nor staff asks for that member's bought panel
- **THEN** it answers nothing

Verified by: `build/member-panels-db.test.mjs` under `platformkit test --e2e`, `build/member-panels.test.mjs`

### Requirement: Huddles need no account

A huddle SHALL be a small browser-to-browser call with microphone and camera, docked in the sidebar, and SHALL need no third-party account. Each browser SHALL be handed ICE servers with the standard's time-limited credential.

#### Scenario: the credential

- **WHEN** a browser is handed a TURN credential for a huddle
- **THEN** it is the standard HMAC credential for that user and expiry

Verified by: `build/huddle.test.mjs`

### Requirement: Matrix clients read the same rooms

The spaces SHALL be served as a Matrix homeserver's Client-Server API, so that Element and other Matrix clients sign in with the site password and read and post in exactly the rooms the person can already read.

#### Scenario: a Matrix client

- **WHEN** `matrix-js-sdk` signs in as a member and syncs
- **THEN** it sees that member's rooms and no others, and a message it sends appears in the site's own channel

Verified by: `build/matrix-api.test.mjs` under `platformkit test --e2e`
