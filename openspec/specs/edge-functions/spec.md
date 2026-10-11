# edge-functions

## Purpose

Every server-side action the site takes, as a Deno function with one clear trust model each — the reader's JWT, a webhook's signature, the service role as bearer, or a random secret the caller holds — sharing one set of modules and never trusting a body it can verify elsewhere.

## Requirements

### Requirement: Each function's door

The functions SHALL be, by who may call them:

- the reader's JWT: `book-files`, `session-files` (a booking's recording and transcript, signed for an hour for someone its policy lets read the row), `book-session` (and, for a host or an administrator, `for`: a booking on other people's behalf — no judge, no credit, nothing charged; a reader asking it is refused), `cancel-session` (a move, a cancellation, and for the host a no-show), `session-slots` (a host may read any type's times), `coach-hours` (a coach's own hours and exceptions, read and set), `session-room` (a token into a booking's video room for someone on the booking, the host's with the room's controls; the host's *record* and *end*), `chat-notify`, `spaces` (a member’s own spaces: what they may read, send, edit, withdraw, search and catch up on, and the credentials for a call in a channel they are in — every answer bounded by their memberships, never by what they ask for), `confirm-checkout`, `create-checkout-session` (a guest cart excepted), `create-portal-session`, `print-order` (admins), `send-email` (admins), `email-blast` (admins), `admin` (admins: the content pipe of cloud mode — `cloud-content` — among its calls `publish`, one record or every draft with a message, `drafts`, what waits, and `media`, the file manager's browse and moves over the `content-assets` bucket — `media-library`; `push-pending` by the service bearer from pg_cron, bundling every pending row into one commit), `push-catalog` (admin JWT or the service bearer), `social` (administrators and explicitly invited social publishers: all normalized Social SDK account, publishing, media, analytics, search, graph, comments, messages, notification, status and declared native operations; each call checks the named social-publishing capability, selected adapter's manifest and current Supabase grant)
- a one-time authorization state the caller holds: `social-oauth` (a direct or managed provider callback; state is bound to the initiating invitation/account flow, expires and is consumed once; it does not accept an arbitrary account, destination or return URL)
- the service bearer from Supabase scheduling: `social-publish` (claims due target deliveries and records their independent outcomes; it accepts no user-selected post or account without a due database record)
- a signature over the raw body: `stripe-webhook`, `cal-webhook`, `livekit-webhook` (the room started and finished, a recording landed), `print-webhook` (with `lulu-webhook` as its alias), `social-webhook` (a selected backend's declared signature/shared-secret verification, deduplicated into the Supabase event inbox before processing)
- the service bearer (pg_cron, the deploy): `funnels-run`, `spaces` sweep (the memberships re-evaluated against what fills them, and a call’s leavings cleared), `push` notify, `support` escalate / retain, `session-recordings` pull / retain (and, for an administrator's Fetch again, the reader's JWT), `session-reminders` send / dry
- a random secret the caller holds: `support` (a contact token or a JWT), `email-track` and `email-unsubscribe` (tokens in the link)
- anyone, within its rules: `content` (Contentful's Delivery, Preview, GraphQL and Sync APIs over the published content — a delivery key, or none where the site leaves Delivery public; a preview key for drafts; a key allowed gated content for a gated entry's body; every write refused until the management change), `support-api` (Chatwoot's Client API — a contact's own door, no token, the widget's guards — and Application API under a key of kind support; the webhooks' deliveries asked by the database with the service bearer), `images` (an asset with the Images API's transforms, cached a year), `ingest` (the site's own events with the anon key and, when signed in, the reader's JWT; an external source's with its registered key from an allowed origin — in the site's own batch shape or in PostHog's wire protocol, any official PostHog SDK's — the batch's shape, size and names checked, the country stamped from the host's geo header; PostHog's flags, remote-config and recording endpoints answered with everything off)

#### Scenario: a webhook without its signature

- **WHEN** `stripe-webhook` or `cal-webhook` is called with a bad signature
- **THEN** it answers 400 and writes nothing

Verified by: `build/webhook-doors.test.mjs` — against the functions as served: `cal-webhook` refuses a missing, empty, malformed and well-shaped-but-wrong signature, on a CREATED and on a CANCELLED, and names the signature each time; `stripe-webhook` in an environment with no secret refuses every body with a named code rather than falling through. Then the tables are checked: no purchase, no booking, no entitlement. Removing the signature line makes it write five forged bookings and fails ten checks.

#### Scenario: a social operation by an uninvited reader

- **WHEN** a reader without social-publishing access calls `social` to read accounts, upload media, edit a post, or grant access
- **THEN** it is refused and no protected row, storage object or credential is disclosed or changed

Verified by: `build/social-publishing.test.mjs` against the served local functions with reader, invitee and administrator accounts

#### Scenario: a callback with forged or replayed state

- **WHEN** `social-oauth` receives state that is missing, expired, altered or already consumed
- **THEN** it refuses the callback and creates or changes no connected account or credential

Verified by: `build/social-publishing.test.mjs` against the served local function

#### Scenario: a scheduled call without the service bearer

- **WHEN** `social-publish` is called without the scheduled-job credential, or with a due delivery identifier that is not claimable
- **THEN** it refuses the request or claims no delivery and publishes nothing

Verified by: `build/social-publishing.test.mjs` against the served local function

#### Scenario: a social webhook without its provider verification

- **WHEN** `social-webhook` receives an event with a missing, invalid, or unsupported signature mechanism
- **THEN** it refuses the event and writes no webhook inbox row or provider state

Verified by: `build/social-webhook.test.mjs` against the served local Supabase function

#### Scenario: a publish by a reader

- **WHEN** `admin` is called with `publish` under a reader's JWT
- **THEN** it is refused (403) and no row changes

Verified by: the door test in `store.test.mjs` with the seed's accounts

#### Scenario: the library by a reader

- **WHEN** `admin` is called with `media` under a reader's JWT
- **THEN** it is refused (403) and nothing in the bucket is read or moved

Verified by: the door test in `store.test.mjs` with the seed's accounts

#### Scenario: another coach's hours

- **WHEN** `coach-hours` is asked to set hours under a member's JWT, or a coach asks for another coach's
- **THEN** it is refused (403) and no row changes

Verified by: `build/scheduling.test.mjs` with the seed's accounts

#### Scenario: a stranger asks for a room token

- **WHEN** `session-room` is asked for a token under the JWT of a reader who is not on the booking
- **THEN** it is refused (403); the attendee and the host each receive one, the host's carrying the room's controls

Verified by: `build/meetings.test.mjs` with the seed's accounts

#### Scenario: a reader books for others

- **WHEN** `book-session` is asked with `for` under a member's JWT
- **THEN** it is refused (403) and nothing is booked

Verified by: `build/scheduling.test.mjs`

#### Scenario: a batch under an unknown key

- **WHEN** `ingest` receives a batch with a source key the config does not register, or from an origin the source does not allow
- **THEN** it answers 403 and writes nothing

Verified by: `analytics-sdk.test.mjs` against the served function

#### Scenario: a draft asked with a delivery key

- **WHEN** `content` is asked for an unpublished entry, or a query with `preview: true`, under a delivery key or no key
- **THEN** it answers `NotFound` for the entry and `AccessDenied` for the query, and a revoked key of any kind answers `AccessTokenInvalid`

Verified by: `content-api.test.mjs`

#### Scenario: a space's door asked for another space

- **WHEN** `spaces` is called under a reader's JWT for a channel of a space they are not a member of, by every call it answers
- **THEN** each is refused and nothing of that space is disclosed, its existence included

Verified by: `build/spaces-db.test.mjs`

### Requirement: The ledger is one module

What a payment writes — purchases, subscriptions, entitlements, credits, print orders, the order email — SHALL be `_shared/ledger.ts`, called by the webhook with Stripe's objects, by `confirm-checkout` with the retrieved session, and by the mock with the same objects made up, so a mock purchase differs from a real one only by its ids.

#### Scenario: the same session twice

- **WHEN** the webhook and the confirmation both write one session
- **THEN** one purchase, one order and one email result

Verified by: `build/ledger.test.mjs` for the decisions (every grant’s source id is a function of the payment and nothing else) and `build/money-db.test.mjs` for the database enforcing them against the stack: one session is one purchase, the second insert refused and the upsert both writers use accepted, one grant is one row, and three credits from one payment are THREE — with the shared-id case shown folding into one, which is why the per-unit id exists. Weakening the constraint fails four checks.

### Requirement: Shared modules, shared words

`_shared/` SHALL hold the one cors and helpers (`lib.ts`), the offers and their Stripe matching (`offers.ts`), the ledger, the email sender and fill (`email.ts`, `emails/`), the marketing sender and rules, the printers, `cal.ts` with the one judge, the content pipe (`pipe/`: the models and the grammars, assembled from the kit's build, refused on drift) and `github.js` (the push as one commit through the git data API — the blobs, a tree over the branch's head, a commit, the ref — plain JavaScript on fetch alone, so a kit test runs it under Node with the API mocked), and the words the functions carry (`strings.json`, `compiled.json`, `funnels.json`, `catalog.json`) written by the build — a function never has a reader-facing string of its own.

#### Scenario: a function's words

- **WHEN** a function sends a line a person reads
- **THEN** it comes from `strings.json` or a compiled design

Verified by: reading; `emails.mjs --check` and `funnels.mjs --check` for what is compiled

### Requirement: Mocks are local only

`STRIPE_MOCK=1` and `PRINT_MOCK=1` SHALL make the whole buying and printing chain run with no account; the deploy refuses them; ids the mocks make up never reach Stripe or a printer.

#### Scenario: a mock id met live

- **WHEN** a `sub_mock_…` subscription is met with the mock off
- **THEN** it is ended in the ledger and the person subscribes for real

Verified by: NOT VERIFIED by a pinned test — it needs a mock subscription met with the mock switched OFF, which is a two-run test against the served functions rather than arithmetic.

### Requirement: The functions on the site's own domain

Reader-facing links to a function SHALL be written under `PUBLIC_FUNCTIONS_URL` when set (the host rewrites `/v1/*` — a rewrite, never a redirect, which turns a POST into a GET) and the client points supabase-js there through `VITE_PUBLIC_FUNCTIONS_URL`; unset, the project's own address is used and the shell forwards `/v1/…` before anything loads.

#### Scenario: a redirect instead of a rewrite

- **WHEN** the host answers `/v1/support` with a 301
- **THEN** every POST from the browser arrives as a GET and fails — the deploy log and the widget both say so, and the rule must be a rewrite

Verified by: observed in production on 2026-09-17; NOT pinned

### Requirement: Placement in PlatformKit

**Module switch:** —.

**Layers.** core: every function today, `_shared`, the ledger. site: its own functions beside them.

**Extension points this needs:** functions assembled into one directory with `_shared` copied; a site function imports `_shared` by relative path as a kit one.

**What the kit's module leaves to its comparable, on purpose:** —.

This capability SHALL land in the layers above, SHALL be switched by its module, and SHALL expose the extension points named; a site SHALL keep its side as registrations, never as patches.

#### Scenario: a site function

- **WHEN** a site function
- **THEN** it serves locally and deploys with the kit's, and it reads the kit's `_shared` without a package import

Verified by: the kit's CI against the demo, and the representative site fixture remains visually unchanged after the change
