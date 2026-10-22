# Spec Delta

## ADDED Requirements

### Requirement: Usage is a record of what happened, and nothing is billed twice

What somebody used SHALL be recorded as state — never anything a redeploy restores — append-only,
each record keyed uniquely on the single piece of work that produced it, so that a retried run, a
replayed provider notification or a listener that reconnected mid-conversation SHALL record nothing
the second time. A person SHALL be able to read their own usage and SHALL NOT be able to write any
of it.

#### Scenario: already-reported work is replayed

- **WHEN** a run is retried after a failure, or a provider notification arrives twice, for work already recorded and reported
- **THEN** no second record is written, no balance moves, and nothing further is reported to the provider

Verified by: `build/usage-db.test.mjs` against a reset stack — the same work submitted twice and the row count unchanged

#### Scenario: a meter-event acknowledgement is uncertain

- **WHEN** Stripe's response to a meter event is uncertain and the event is retried inside Stripe's rolling identifier-uniqueness window
- **THEN** the same stable identifier is reused so Stripe does not count the usage twice

Verified by: `build/usage.test.mjs`

#### Scenario: an uncertain meter event outlives Stripe's uniqueness window

- **WHEN** an unconfirmed meter event is still unresolved after the documented 24-hour minimum uniqueness period
- **THEN** automatic resubmission stops and the usage is surfaced for reconciliation rather than risking a duplicate charge

Verified by: `build/usage.test.mjs`

#### Scenario: a person reads their usage

- **WHEN** a person asks what they have used and what they have left
- **THEN** they see their own and nobody else's, and can change none of it

Verified by: `build/usage-db.test.mjs` under the policies, as each of two people

#### Scenario: a balance is derived, and whatever writes it owns it

- **WHEN** a balance is read
- **THEN** it equals what was granted less what was used, and nothing but the platform's own writer has ever written it

Verified by: `build/declarations.test.mjs` (state, not projected, no write granted to `authenticated`); `build/usage-db.test.mjs` recomputing the balance from the records and comparing

### Requirement: Speech is measured as well as thinking

Where a conversation is spoken, what was spent turning speech into text and text into speech SHALL
be recorded against the same person and the same bot as the thinking was, so that what a site bills
for a spoken minute is what a spoken minute cost it. A record of speech SHALL be keyed as every
other usage record is, so a reconnection bills nothing twice.

#### Scenario: a spoken conversation

- **WHEN** a person holds a spoken conversation with a billed bot
- **THEN** the speech and the thinking are both recorded against them, and the total is what the conversation cost rather than the thinking alone

Verified by: `build/usage.test.mjs` with a recorded session; one live spoken conversation whose recorded total is compared with the providers' own figures

#### Scenario: the listener reconnects

- **WHEN** the listener drops and rejoins the same conversation
- **THEN** the seconds already recorded are not recorded again

Verified by: `build/usage.test.mjs`

### Requirement: Speculative work is never charged to anybody

Where the platform does work speculatively — producing a reply or speech before it is known to be
wanted — what is discarded SHALL NOT be charged to the person, even though it was spent. What was
spent SHALL still be visible to the site, so the cost of speculation is somebody's decision rather
than a hidden loss.

#### Scenario: a speculative turn is discarded

- **WHEN** a reply or its speech is produced speculatively and then thrown away because the person had not finished speaking
- **THEN** nothing is charged to them, and the site can still see what it spent

Verified by: `build/usage.test.mjs` — a discarded speculative turn recorded as cost with no billed units

### Requirement: Every configured billable invocation is authorized before paid work

Any server-side operation configured for usage billing SHALL be able to use the same
surface-independent authorization and settlement contract, whether or not it belongs to a bot,
agent, voice session, page, or named module. The gate SHALL bind the operation to a
server-verified subject, stable offer identity, and idempotent invocation identity; bot or
surface metadata MAY be recorded but SHALL NOT be required for billing. Before paid provider
work begins, the gate SHALL atomically reserve enough prepaid units for the operation's bounded
maximum, or verify an active subscription for the same usage offer that authorizes the declared
metered usage. If neither authorization is valid, the operation SHALL be refused before its
provider is called. Long-running work SHALL obtain further authorization before exceeding its
reservation. Successful work SHALL settle server-measured usage idempotently and release unused
reservation; failed or abandoned work SHALL release unused reservation without recording a
second charge on retry.

#### Scenario: a non-bot operation uses the common gate

- **WHEN** a site server operation outside the bot and voice surfaces requests billable work for an authenticated subject
- **THEN** it can use the same gate with its offer and invocation identity, and the provider runs only after authorization

Verified by: `build/usage.test.mjs` with a non-bot invocation fixture

#### Scenario: neither prepaid units nor an active usage subscription exists

- **WHEN** an invocation has insufficient reservable credits and no active subscription authorizing that usage offer
- **THEN** it is refused before the provider call, with no billable usage or meter event recorded

Verified by: `build/usage-db.test.mjs` with a provider-call counter

#### Scenario: concurrent invocations compete for the last prepaid units

- **WHEN** concurrent invocations request reservations whose combined maximum exceeds the subject's available credits
- **THEN** authorization admits no more work than the credits can cover

Verified by: `build/usage-db.test.mjs` with concurrent reservation attempts

#### Scenario: an active subscription authorizes metered work

- **WHEN** the subject has an active subscription for the same usage offer and the offer permits metered usage
- **THEN** the invocation may proceed and its measured billable usage is reported once under that offer

Verified by: `build/usage-db.test.mjs` and `build/usage.test.mjs` with an active and an expired subscription

#### Scenario: a long-running invocation reaches its reservation

- **WHEN** a stream or other long-running invocation reaches its currently authorized maximum
- **THEN** further billable work proceeds only after another authorization succeeds; otherwise the work stops before more provider usage is incurred

Verified by: `build/usage.test.mjs` with a bounded streaming fixture

### Requirement: Automatic top-up charges are reader-authorized, capped by the reader, and idempotent

The platform SHALL attempt an automatic top-up only when both the site's configuration and
the reader's explicit preference enable it. The reader's preference SHALL identify an eligible
prepaid offer, a usage-balance threshold, explicit consent to off-session payment, and the
reader's own maximum top-up spend per calendar month. No site-owner setting SHALL impose or
raise a per-reader spending cap. The platform SHALL derive the reader, offer, price, and payment
method from trusted server-side records, serialize concurrent attempts, and use a stable
idempotency identity for each charge. A confirmed payment SHALL grant the declared pack once;
an unconfirmed, declined, or authentication-required payment SHALL grant nothing and SHALL NOT
authorize provider work.

#### Scenario: one low-balance event is observed concurrently

- **WHEN** multiple invocations observe the same reader below their configured threshold
- **THEN** the platform makes at most one charge for the top-up attempt and inserts at most one corresponding grant

Verified by: `build/usage-db.test.mjs` and mocked Stripe idempotency assertions in `build/usage.test.mjs`

#### Scenario: payment succeeds but grant persistence is delayed

- **WHEN** Stripe confirms a top-up payment but the grant write is retried after a transient failure
- **THEN** the same payment identity is used, the grant is recorded once, and no invocation is authorized until the grant is visible in the balance

Verified by: `build/usage-db.test.mjs` with repeated payment-grant delivery

#### Scenario: reader's cap or site switch blocks top-up

- **WHEN** the site disables automatic top-up or the reader's personal monthly cap is exhausted
- **THEN** the platform attempts no charge and refuses any invocation the available balance cannot cover before its provider is called

Verified by: `build/usage.test.mjs` with a provider-call counter
