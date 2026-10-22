# Spec Delta

## ADDED Requirements

### Requirement: A billable invocation is reserved against its site's provider chain and rates

A billable invocation SHALL resolve its operation policy, providers, fallback order, model tariffs, and customer markup from the site that owns the invocation. A site-funded operation SHALL record provider cost without charging reader credits or a reader's metered subscription. A prepaid or metered operation SHALL reserve enough authorization for the maximum cost of the configured attempts before the first external provider call. Each attempt SHALL be attributed to its actual provider and model. An unknown operation, provider, missing tariff, or reservation too small for the configured fallback chain SHALL refuse reader-billed work before provider work. A request or response SHALL NOT be able to substitute another site's or operation's policy.

#### Scenario: provider costs differ across sites

- **WHEN** the same operation and model name are invoked for two sites with different provider tariffs
- **THEN** each reservation and settlement uses only the owning site's provider chain and rates

Verified by: `build/usage-db.test.mjs` and the isolated multi-site provider configuration test

#### Scenario: a fallback attempt may also incur cost

- **WHEN** a provider attempt fails and the site's policy allows another provider
- **THEN** each attempt remains covered by an authorization reservation and is settled or conservatively estimated separately before unused reservation is released

Verified by: `build/usage.test.mjs` with a billed fallback chain and provider-call counters

#### Scenario: the chain cannot be fully reserved

- **WHEN** available credits or the active subscription policy cannot cover the configured maximum provider-attempt cost
- **THEN** the invocation is refused before any external provider call

Verified by: `build/usage-db.test.mjs` with an insufficient-balance provider-call counter

#### Scenario: a site-funded operation still records upstream spend

- **WHEN** an explicitly site-funded operation completes a provider attempt
- **THEN** the site can audit its provider cost and actual operation without debiting reader credits or reporting reader-metered units

Verified by: `build/usage-db.test.mjs` and the usage report fixture

#### Scenario: deleting a reader anonymizes but retains attempt accounting

- **WHEN** a reader account that has inference attempts is deleted
- **THEN** its attempts retain provider, operation, cost, sponsor, and measurement evidence while the reader identity is removed

Verified by: `build/usage-db.test.mjs`

### Requirement: Missing provider usage is never recorded as zero-cost work

When a provider may have processed a billable request but returns no valid usage measurement, the platform SHALL settle that attempt at its previously reserved maximum and mark the cost as estimated. A failure proven to occur before the provider received the request SHALL release that attempt's reservation. A fallback SHALL proceed only when its additional maximum cost is already authorized. The resulting ledger SHALL preserve the measured-versus-estimated distinction for site reporting and reconciliation.

#### Scenario: the provider completes without usage counters

- **WHEN** a provider may have performed billable work but its response has no valid usage counters
- **THEN** the user is not granted free work through a zero-cost settlement; the reserved maximum is charged and the event is marked estimated

Verified by: `build/usage-db.test.mjs` and `build/usage.test.mjs`

#### Scenario: a transport failure is known to precede provider receipt

- **WHEN** the server can establish that no provider received the request
- **THEN** that attempt's reservation is released and no provider cost is recorded for it

Verified by: `build/usage.test.mjs` with a pre-send transport failure fixture
