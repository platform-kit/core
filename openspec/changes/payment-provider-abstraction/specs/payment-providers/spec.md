# Spec Delta

## Purpose

Payment providers let a site use Stripe or a complete site-owned adapter for purchases, subscriptions, usage billing, catalog synchronization, and payouts through a stable server-side contract. PlatformKit retains shared checkout orchestration, ledger, and entitlement decisions while provider-specific operations are implemented and declared explicitly.

## ADDED Requirements

### Requirement: A site selects one payment provider

A site SHALL select one registered payment provider for its payment workflows with `payments.provider`. Registered providers SHALL include the built-in Stripe adapter and adapters contributed by enabled site-owned modules. When `payments.provider` is omitted, an existing Stripe-configured site SHALL continue to use Stripe without requiring a configuration change. An unknown provider or one contributed only by a disabled module SHALL fail configuration or deployment validation. A site SHALL NOT silently route a payment operation to a different provider or fail over when the selected provider is unavailable.

#### Scenario: Existing Stripe site without an explicit provider

- **WHEN** a site has Stripe credentials and no provider selection
- **THEN** its checkout, billing, and reconciliation continue through Stripe with the existing behavior

Verified by: `build/payment-providers.test.mjs` and existing checkout, ledger, and usage tests

#### Scenario: Site selects a registered provider

- **WHEN** a site sets `payments.provider` to a configured provider and supplies that adapter's required secrets
- **THEN** payment operations use only that provider, and no provider secret is exposed to browser code

Verified by: `build/payment-providers.test.mjs` and `build/deploy-checks.mjs` tests

#### Scenario: Site selects an unregistered or disabled provider

- **WHEN** `payments.provider` names no built-in provider or enabled site-owned registration
- **THEN** configuration or deployment validation fails with the provider id; no provider fallback is attempted

Verified by: `build/payment-providers.test.mjs` and `build/deploy-checks.mjs` tests

### Requirement: A site can implement and register its own provider

A site SHALL be able to implement a complete payment adapter in site-owned server code and register it through the site module extension model using the published provider contract, without modifying PlatformKit or another package. The adapter SHALL provide custom code for every provider operation used by the site's enabled payment features, including checkout, customer, subscription, portal, catalog, refund, usage, payout, and webhook operations where those features are declared. Registration SHALL declare the adapter's identity, capabilities, required server-side secrets, and webhook handling. The selected adapter SHALL be assembled only from trusted site code and SHALL NOT expose its implementation or secrets to browser code.

#### Scenario: A site-owned provider is registered without a kit change

- **WHEN** a site module implements the contract, declares its required secrets and webhook route, registers the adapter, and the site selects it
- **THEN** the assembled site serves its payment workflows through that adapter, deploy validation requests its declared secrets, and no PlatformKit source change is needed

Verified by: `build/site-payment-provider.test.mjs` using a site-owned mock adapter fixture and deploy checks

#### Scenario: An unregistered provider is selected

- **WHEN** site configuration names an adapter that no built-in or site-owned module registered
- **THEN** assembly or deployment fails with the missing provider named; no Stripe fallback or payment request is attempted

Verified by: `build/site-payment-provider.test.mjs`

### Requirement: Payment workflows use provider-independent outcomes

The site SHALL retain its own offer catalog and order, subscription, and entitlement decisions. A provider adapter SHALL translate checkout, customer, subscription, catalog synchronization, refund, and usage-reporting operations where supported, and SHALL return normalized outcomes sufficient for those site-owned decisions. Each adapter SHALL authenticate and verify webhook origin and integrity using the provider's documented mechanism before events are normalized or applied; a signature is required only where the provider supplies one.

#### Scenario: Purchase is completed through the selected provider

- **WHEN** a supported checkout is paid and the provider sends a valid completion event
- **THEN** the site records the purchase and grants the same entitlements as the equivalent Stripe purchase, without using provider product descriptions as the source of the offer

Verified by: `build/payment-providers.test.mjs` and `build/ledger.test.mjs`

#### Scenario: Site-owned adapter produces a normalized purchase event

- **WHEN** a site-owned adapter verifies and normalizes its provider's successful payment event
- **THEN** the shared ledger records the purchase and grants the offer's entitlement without requiring a provider-specific ledger path

Verified by: `build/site-payment-provider.test.mjs` and `build/ledger.test.mjs`

#### Scenario: Invalid provider webhook

- **WHEN** a webhook fails the selected provider's configured authentication or integrity checks
- **THEN** the event is rejected and no purchase, subscription, entitlement, usage grant, or payout state is changed

Verified by: `build/payment-providers.test.mjs` and `build/webhook-doors.test.mjs`

#### Scenario: Provider event is delivered more than once

- **WHEN** the same normalized provider event is delivered repeatedly
- **THEN** its effects are applied at most once, with event identity scoped to that provider

Verified by: `build/payment-providers.test.mjs` and `build/ledger.test.mjs`

### Requirement: Provider capabilities are explicit

Each provider SHALL declare the payment operations and optional features it supports, including subscriptions, trials, tax handling, payment-method selection, adjustable quantities, catalog synchronization, usage metering and top-ups, refunds, connected-account onboarding, account readiness checks, and payouts. Before creating a checkout or billing action, the site SHALL refuse an operation requiring an unsupported capability with an actionable error; it SHALL NOT silently omit the requested behavior or make a charge with different terms.

#### Scenario: Unsupported checkout option

- **WHEN** an offer requests a feature the selected provider does not support
- **THEN** checkout is refused before a provider session is created, and the response identifies the unsupported feature

Verified by: `build/payment-providers.test.mjs` and `build/checkout-params.test.mjs`

#### Scenario: Unsupported connected-account operation

- **WHEN** provider payouts are enabled but the selected adapter does not support connected-account onboarding, readiness checks, or payouts
- **THEN** the requested operation is refused before a provider request or payout-ledger claim, and no payout is attempted through another provider

Verified by: `build/payment-providers.test.mjs` and `build/payouts-db.test.mjs`

### Requirement: Metered usage can be charged incrementally

A site SHALL be able to opt a metered subscription offer into incremental usage charges by setting `usage.incrementalCharge` to a positive amount in the offer currency. For each full threshold of billable metered usage accrued during a billing period, PlatformKit SHALL initiate a separate off-session payment for the threshold through the selected provider. At period close, PlatformKit SHALL collect any remaining metered balance once through the same provider. PlatformKit SHALL persist period-scoped settlement progress so retries do not duplicate successful charges, and SHALL retain failed or action-required amounts as unsettled rather than marking them paid. An authenticated subscription owner SHALL be able to complete provider-required payment authentication, and the server SHALL verify the provider's current payment status before recording success. A definitive failed attempt MAY be retried with a new idempotency identity after using the current saved payment method; an uncertain or processing attempt SHALL retain its idempotency identity until reconciled. For an opted-in offer, usage SHALL NOT also be submitted to provider-native metering in a way that charges the same usage again. This behavior is a captured payment, not an increase to an existing authorization hold. Offers without the setting SHALL retain their current usage-billing behavior.

#### Scenario: A site opts into threshold usage charges

- **WHEN** a metered subscription offer sets `usage.incrementalCharge` and accrued billable usage crosses one or more full thresholds
- **THEN** PlatformKit creates one idempotent off-session payment for each crossed threshold through the selected provider, while preserving any below-threshold remainder for period-close settlement

Verified by: Stripe and Hyperswitch usage-settlement tests, including retries and threshold boundaries

#### Scenario: Incremental usage charges do not duplicate native metering

- **WHEN** an opted-in offer's usage is charged incrementally
- **THEN** the same usage is not also reported to provider-native metering, and the uncollected period-end remainder is settled once through the selected provider

Verified by: Stripe and Hyperswitch usage-settlement tests

#### Scenario: Incremental usage payment is declined or requires action

- **WHEN** a threshold payment is declined or requires customer action
- **THEN** the amount remains unsettled, no successful settlement is recorded, the subscription owner can authenticate or retry through the usage page, and uncertain provider outcomes do not create a new idempotency identity

Verified by: Stripe and Hyperswitch usage-settlement failure tests

#### Scenario: Stripe incremental usage enables customer authentication

- **WHEN** Stripe is selected and a published metered offer enables `usage.incrementalCharge`
- **THEN** deploy validation requires a live `STRIPE_PUBLISHABLE_KEY`; sites without an opted-in offer do not need this key

Verified by: `build/deploy-checks.mjs --test`

### Requirement: Stripe behavior remains supported behind its adapter

The Stripe adapter SHALL preserve the currently supported Stripe checkout, subscription changes, customer portal, Markdown catalog synchronization, tax and payment-method options, order and subscription reconciliation, usage billing and metering, refunds, and connected-account payout behavior. Existing Stripe environment configuration and webhook deliveries SHALL continue to work during migration.

#### Scenario: Stripe regression coverage

- **WHEN** the existing commerce, webhook, payout, and usage test suites run using the Stripe mock
- **THEN** their existing outcomes remain unchanged, including guest purchases, subscription changes, usage grants and reports, refunds, and payouts

Verified by: `build/ledger.test.mjs`, `build/checkout-params.test.mjs`, `build/usage.test.mjs`, `build/usage-db.test.mjs`, `build/payouts-db.test.mjs`, and `build/webhook-doors.test.mjs`

### Requirement: Markdown remains the payment catalog source

The site's Markdown product and offer files SHALL remain authoritative for Stripe and any site-owned adapter that declares catalog synchronization. A catalog push SHALL create or update the selected provider's corresponding catalog objects from the compiled site catalog; provider catalog descriptions or prices SHALL NOT silently replace the site's declared offer data. The existing Markdown-to-Stripe push SHALL remain available unchanged to Stripe sites.

#### Scenario: Markdown offers are pushed to Stripe

- **WHEN** a Stripe site deploys or updates its catalog
- **THEN** the existing catalog build compiles the Markdown offers and the Stripe push creates or updates their Stripe products and prices by stable offer identity

Verified by: `build/catalog.test.mjs`, `build/steps/push-catalog.mjs` tests, and `build/payment-providers.test.mjs`

#### Scenario: A site-owned adapter synchronizes Markdown offers

- **WHEN** a site selects an adapter that declares catalog synchronization and deploys or updates its catalog
- **THEN** the adapter receives the compiled Markdown offers, maps them to provider catalog objects, and repeating the push reuses or updates matching records rather than creating duplicate sellable offers

Verified by: `build/site-payment-provider.test.mjs` using the site-owned mock adapter fixture

### Requirement: Site-owned adapters declare implemented operations

Each site-owned adapter SHALL advertise only capabilities whose corresponding operations it implements. Before any provider-side effect, the shared workflow SHALL verify that the selected adapter implements and declares every capability required by the requested checkout or billing action. Unsupported operations SHALL fail explicitly and SHALL NOT be represented as Stripe-equivalent.

#### Scenario: A site implements the payment operations it enables

- **WHEN** a site registers a custom adapter with declared capabilities and provider-operation implementations
- **THEN** the assembled provider registry exposes only that adapter's declared operations, and selecting an unavailable operation fails before a provider request

Verified by: `build/site-payment-provider.test.mjs` and `build/payment-providers.test.mjs`
