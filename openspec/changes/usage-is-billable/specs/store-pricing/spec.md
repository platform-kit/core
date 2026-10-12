# Spec Delta

## Purpose

Defines how a site sells named units of assistant usage through prepaid packs or provider-metered subscriptions.

## ADDED Requirements

### Requirement: An offer may be sold by the unit, and the site names the unit

An offer MAY declare a unit it is sold by — what the unit is called, and what one costs — and the
platform SHALL convert what something actually cost to serve into that unit by the declared rate.
The unit SHALL be the site's own word, never a model's token, a provider's name or a figure of what
the platform paid, so that changing which model answers SHALL NOT change what anybody is charged or
what any invoice says. An offer declaring no unit and no meter SHALL behave exactly as it does
today.

#### Scenario: the model changes and the price does not

- **WHEN** the model a bot uses is changed to one that costs twice as much per word
- **THEN** what a person is charged per unit is unchanged, and the site's own margin per unit falls

Verified by: `build/usage.test.mjs`

#### Scenario: an offer with no unit

- **WHEN** an offer declares neither a unit nor a meter
- **THEN** it is pushed to Stripe and sold exactly as before, with no usage recorded against it

Verified by: `build/usage.test.mjs`; `build/catalog.mjs --check` in `npm test`

#### Scenario: a rate that would lose money

- **WHEN** a site sets a unit price below what one unit has actually been costing to serve
- **THEN** the admin says so beside the field, with both figures, and still allows it

Verified by: screenshots of the pricing panel in both themes, read before reporting

### Requirement: Usage is sold either as a pack bought up front or as a meter billed in arrears

The platform SHALL support both: an offer bought once that grants a quantity of units, and a
subscription whose usage is reported to the payment provider and invoiced by it. A site SHALL
choose per offer, and both SHALL be expressible in the offer's own file with no code.

#### Scenario: a pack is bought

- **WHEN** somebody buys an offer that grants units
- **THEN** their balance rises by that quantity, once, and is theirs to spend against any bot billed to that offer

Verified by: `build/usage-db.test.mjs` against a reset stack, through the mock checkout

#### Scenario: a metered subscription is used

- **WHEN** a subscriber on a metered offer uses units
- **THEN** the usage is reported to the provider against their subscription, and the provider's invoice is the sum of what was reported

Verified by: `build/usage.test.mjs` against the Stripe mock — the events reported, and their sum compared with the usage rows

#### Scenario: a metered offer with no provider configured

- **WHEN** a site declares a metered offer and has no payment provider configured
- **THEN** the deploy refuses before it runs anything, naming the offer and the keys

Verified by: `build/deploy-checks.mjs --test`

#### Scenario: metered offers have isolated currencies and meter names

- **WHEN** two metered offers share one Stripe meter event name, or a metered offer is assigned a price in another currency
- **THEN** catalog compilation refuses the configuration before it can be sold

Verified by: `build/usage.test.mjs`

### Requirement: Usage offers authorize access before provider work

A usage offer SHALL distinguish prepaid authorization from subscription-metered authorization.
Prepaid use SHALL require enough available units to cover an atomic reservation for the
invocation's bounded maximum. Metered use SHALL require a currently active subscription
associated with that same stable offer identity and SHALL be reported only under the offer's
declared meter and overage terms. An exhausted prepaid balance, an expired or unrelated
subscription, or an unbounded invocation without a further authorization boundary SHALL not
authorize paid provider work. Offers without usage settings SHALL retain their existing behavior.

#### Scenario: prepaid units do not cover the invocation

- **WHEN** a prepaid subject's remaining units are less than the invocation's maximum reservation and no active usage subscription authorizes it
- **THEN** the invocation is refused before provider work, and the balance is unchanged

Verified by: `build/usage-db.test.mjs` and `build/usage.test.mjs`

#### Scenario: an active matching subscription covers metered use

- **WHEN** a subject has an active subscription for the usage offer and the offer declares metered overage
- **THEN** work may proceed under that offer, including after its included allowance is used, and overage is attributed to its stable offer identity

Verified by: `build/usage-db.test.mjs` and `build/usage.test.mjs`

#### Scenario: the matching subscription is no longer active

- **WHEN** a subscription has expired or is not associated with the invocation's usage offer
- **THEN** it authorizes no new provider work, regardless of the client's claim about its status

Verified by: `build/usage-db.test.mjs`

### Requirement: Automatic top-up is enabled by the site and controlled by the reader

A site MAY enable automatic top-up in its site configuration and SHALL make clear which
prepaid usage offers are eligible. Automatic top-up SHALL be off unless the site enables it
and the reader explicitly opts in. The reader SHALL choose an eligible pack, the balance
threshold that triggers a refill, and their own maximum automatic top-up spend per calendar
month. The site owner SHALL NOT set a per-reader spending cap. The reader SHALL be able to
change or disable their preference.

Before charging, the server SHALL verify the current site switch, the reader's opt-in and
remaining personal cap, the selected eligible offer, and the reader's explicit consent to
off-session use of a saved payment method. It SHALL use the declared offer's stable identity
and amount, create no more than one charge for a retryable top-up attempt, and grant units
only after Stripe confirms payment. Top-up SHALL not authorize provider work while payment
is declined, requires interactive authentication, or has not yet produced a recorded grant.

#### Scenario: the site has automatic top-up disabled

- **WHEN** a reader has previously opted in but the site disables automatic top-up
- **THEN** no automatic charge is attempted and the billable invocation is refused before provider work if the available balance cannot cover it

Verified by: `build/usage.test.mjs` with the site switch off and a provider-call counter

#### Scenario: a reader's balance reaches their threshold

- **WHEN** the site enables automatic top-up, a reader has opted in with a saved payment method, the balance is at or below their threshold, and their personal monthly cap has room
- **THEN** the server charges one selected eligible pack off-session, records its confirmed grant once, and admits the invocation only if the resulting balance covers its bounded reservation

Verified by: `build/usage.test.mjs` and `build/usage-db.test.mjs` with the Stripe mock and a usage balance

#### Scenario: a reader reaches their personal monthly cap

- **WHEN** the next automatic top-up would exceed the reader's own monthly cap
- **THEN** no charge or grant is created and the invocation is refused before provider work; the site owner does not override or raise that cap

Verified by: `build/usage.test.mjs` with repeated top-up attempts and a provider-call counter

#### Scenario: a top-up is retried or races with another invocation

- **WHEN** the same top-up attempt is retried, or concurrent invocations reach the low-balance threshold together
- **THEN** no duplicate charge or grant is created for that attempt, and no invocation proceeds without enough confirmed credits for its reservation

Verified by: `build/usage.test.mjs` and concurrent cases in `build/usage-db.test.mjs`

#### Scenario: payment is declined or requires authentication

- **WHEN** Stripe declines the off-session payment or requires the reader to authenticate it
- **THEN** no usage grant is written, the paid provider is not called, and the reader is told that payment action is needed

Verified by: `build/usage.test.mjs` with declined and authentication-required payment fixtures

### Requirement: Readers manage usage outside chatbot conversations

The platform SHALL provide a dedicated reader usage page at `/app/usage` for balance,
cross-operation usage history, purchases, and automatic top-up preferences. The page SHALL
work independently of any bot or conversation and SHALL show only the signed-in reader's
own usage. Assistant conversation-history surfaces SHALL retain their conversation controls
and SHALL NOT be replaced by usage statistics.

#### Scenario: a reader with usage from multiple operations checks their balance

- **WHEN** a reader opens `/app/usage`
- **THEN** they see their own balance and usage history across all billable operations, with no chatbot required

Verified by: `build/usage.test.mjs` and the reader-page browser probe

#### Scenario: usage management is opened from an assistant conversation surface

- **WHEN** a reader follows a usage link from an assistant
- **THEN** the link opens the dedicated `/app/usage` page while past conversations remain available in the assistant's history

Verified by: the reader-page browser probe
