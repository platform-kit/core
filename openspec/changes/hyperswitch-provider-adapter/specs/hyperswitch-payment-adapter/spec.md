# Spec Delta

## Purpose

The built-in Hyperswitch provider lets a site keep PlatformKit's complete shared commerce behavior while using Hyperswitch as its only payment processor. Payment movement uses Hyperswitch's unified API; PlatformKit supplies site-owned commerce behavior where Hyperswitch does not document a native equivalent.

## ADDED Requirements

### Requirement: Hyperswitch exposes documented V2 payment capabilities only

The built-in Hyperswitch provider SHALL use the documented Router APIs of a V2 Router for every Hyperswitch operation it exposes: `/v2` routes for payments and refunds, and the Router's payment-method service group (customers, payment-method sessions, saved methods) under the prefix that Hyperswitch's Vault SDK guide and the Web SDK use, `v1` by default: the adapter's `HYPERSWITCH_PAYMENT_METHODS_PREFIX` and the Router's `payment_methods_prefix` must match, and neither moves payments or refunds. It SHALL NOT call the V1 Router's payment, refund, or payout APIs or fall back to a different API version when a route is unavailable. PlatformKit MAY provide offer/catalog management, recurring billing state, usage accounting, and customer self-service through its shared commerce layer where Hyperswitch does not document a native equivalent. An operation that lacks a documented V2 payment API SHALL NOT be advertised as a Hyperswitch capability and SHALL fail explicitly before creating a payment or changing commerce state. In particular, connected-account payouts remain unavailable until Hyperswitch documents a V2 payout API.

#### Scenario: V2-backed provider capabilities are available

- **WHEN** a site selects and configures the built-in Hyperswitch provider
- **THEN** every V2-backed capability declared for the configured profile is available with the same PlatformKit-level behavior, using Hyperswitch for payment movement and the shared commerce layer for PlatformKit-managed behavior

Verified by: `build/hyperswitch-payment-provider.test.mjs` capability-contract matrix, V2 adapter tests, and V2 Router integration coverage

#### Scenario: Checkout preserves the site's requested terms

- **WHEN** a site's checkout requests a subscription, trial, tax collection, payment-method selection, adjustable quantity, shipping address, or shipping option
- **THEN** the Hyperswitch checkout honors each requested term and returns a normalized checkout result, or reports the specific unavailable term before creating a payment or checkout

Verified by: `build/hyperswitch-payment-provider.test.mjs` checkout capability cases and Hyperswitch sandbox integration coverage

#### Scenario: Web SDK checkout is confirmed on a PlatformKit page

- **WHEN** a Hyperswitch checkout is created
- **THEN** PlatformKit renders Hyperswitch's documented Web SDK with the returned client secret, provides an explicit site-owned cancel action, and treats payment as complete only after provider retrieval or an authenticated webhook confirms it

Verified by: V2 adapter and checkout-page tests, plus the V2 Router browser integration test

#### Scenario: Every provider request uses V2 without fallback

- **WHEN** PlatformKit creates, confirms, retrieves, refunds, or manages a Hyperswitch payment method or customer
- **THEN** the operation uses its documented route on the V2 Router (`/v2` for payments and refunds; customers, sessions, and saved methods use the configured payment-method prefix, `v1` by default), and an unavailable route produces an explicit error without retrying through a different API version

Verified by: `build/hyperswitch-payment-provider-adapter.test.ts` request-path assertions and the V2 Router integration suite

#### Scenario: A capability without a V2 API is not exposed

- **WHEN** a site enables connected-account payouts through Hyperswitch while the documented V2 API has no payout operation
- **THEN** Hyperswitch does not declare that capability and refuses the request before any provider or commerce side effect

Verified by: `build/hyperswitch-payment-provider.test.mjs` capability checks and `build/hyperswitch-payment-provider-adapter.test.ts` no-side-effect assertions

#### Scenario: Stripe checkout uses the V2 browser flow

- **WHEN** a customer completes a Stripe test payment through the Hyperswitch checkout page
- **THEN** card entry remains inside the V2-compatible Hyperswitch SDK's secure fields, PlatformKit does not receive card data, and access is granted only after the V2 Router confirms the payment through retrieval or an authenticated webhook

Verified by: the real-browser V2 Stripe integration test, including V2 request-path capture, server-side status verification, and refund

#### Scenario: A self-hosted Web SDK can be selected

- **WHEN** `HYPERSWITCH_CLIENT_URL` is configured with a self-hosted SDK base URL
- **THEN** checkout, incremental-payment recovery, and saved-payment-method management load `HyperLoader.js` from that URL instead of the hosted default, while the private API key remains server-side
- **AND** an omitted setting uses the hosted Hyperswitch Web SDK
- **AND** local HTTP is allowed only for loopback development URLs; deployed configuration requires HTTPS

Verified by: Hyperswitch SDK URL and adapter contract tests and deploy checks; the configured local SDK browser journey remains pending task 3.9

#### Scenario: Recurring and post-purchase operations use the same V2 provider

- **WHEN** a site changes or cancels a subscription, opens a customer portal, synchronizes its catalog, refunds a payment, reports usage, or performs a prepaid top-up
- **THEN** payment movement is performed through Hyperswitch and other behavior is performed through Hyperswitch or PlatformKit's shared commerce layer, returning the corresponding normalized result without changing the site's source-of-truth offers or ledger rules

Verified by: `build/hyperswitch-payment-provider.test.mjs` operation matrix and Hyperswitch sandbox integration coverage

#### Scenario: PlatformKit-managed behavior does not introduce another processor

- **WHEN** the selected provider lacks a documented native API for catalog synchronization, recurring billing management, usage accounting, or a customer portal session
- **THEN** PlatformKit supplies that behavior through its shared commerce layer, and any payment movement still uses the selected Hyperswitch provider

Verified by: `build/hyperswitch-payment-provider.test.mjs` operation matrix and shared commerce checks

### Requirement: Hyperswitch supports optional incremental usage charges

For a metered subscription offer configured with a positive `usage.incrementalCharge` amount in the offer currency, PlatformKit SHALL charge each full threshold of accrued billable usage as a separate off-session payment through Hyperswitch. At period close, it SHALL charge any remaining metered balance once through Hyperswitch, subtracting only successful threshold settlements. The shared ledger SHALL persist period-scoped settlement progress and make retries idempotent. Opted-in usage SHALL be settled by PlatformKit rather than submitted to a nonexistent Hyperswitch usage-event API, and SHALL NOT be charged twice. Failed or action-required payments SHALL remain unsettled. This is a captured payment, not an increase to an existing authorization hold. Offers without the setting SHALL retain the existing renewal-time usage settlement.

#### Scenario: Hyperswitch collects each configured usage increment

- **WHEN** usage for an opted-in offer crosses one or more full thresholds
- **THEN** PlatformKit creates a separate idempotent off-session Hyperswitch payment for each threshold and retains any remainder for period-close settlement

Verified by: Hyperswitch usage-settlement tests and provider integration coverage

#### Scenario: Hyperswitch retries do not duplicate usage charges

- **WHEN** a threshold payment or period-close settlement is retried after a timeout or duplicate invocation
- **THEN** successful threshold payments are not charged again, failed amounts remain outstanding, and no usage is also settled through provider-native metering

Verified by: Hyperswitch usage-settlement idempotency and failure tests

### Requirement: Hyperswitch controls processor selection and routing

PlatformKit SHALL treat Hyperswitch as the site's single selected payment provider and SHALL send provider operations through Hyperswitch's unified API. A site MAY configure multiple processor connectors, payment methods, routing rules, and related payment services in its Hyperswitch profile. PlatformKit SHALL NOT impose a one-connector limit, call those processors directly, or combine Hyperswitch with separate PlatformKit payment providers. A request SHALL retain its required amount, currency, payment method, and checkout terms; when the selected Hyperswitch profile cannot honor a requested term, the request SHALL fail clearly before a payment side effect rather than silently dropping the term.

#### Scenario: Hyperswitch routes across configured connectors

- **WHEN** a site has multiple eligible processor connectors and routing rules configured in Hyperswitch
- **THEN** PlatformKit sends the operation to Hyperswitch and Hyperswitch applies that profile's routing without PlatformKit selecting, calling, or requiring a single underlying processor

Verified by: `build/hyperswitch-payment-provider.test.mjs` request mapping and Hyperswitch sandbox integration coverage using a multi-connector profile

#### Scenario: A configured profile cannot honor a requested term

- **WHEN** no backend available to the selected Hyperswitch profile can honor a required checkout term
- **THEN** the site receives an explicit provider error naming the unmet term and no checkout, payment, or ledger claim is created

Verified by: `build/hyperswitch-payment-provider.test.mjs` pre-side-effect failure cases

#### Scenario: PlatformKit selects Hyperswitch as one provider

- **WHEN** a site configures Hyperswitch with its account or instance, profile, and server credentials
- **THEN** PlatformKit uses Hyperswitch for all payment operations, while processor credentials and connector configuration remain managed through Hyperswitch

Verified by: `build/payment-provider-registry.test.mjs`, `build/deploy-checks.mjs --test`, and the Hyperswitch sandbox integration suite

### Requirement: Hyperswitch events are authenticated and normalized

The Hyperswitch provider SHALL verify outgoing webhook signatures against the original request bytes using the configured business-profile signing key before parsing or applying events. It SHALL normalize documented payment, checkout, refund, invoice, and payout events into PlatformKit's shared event contract. The adapter SHALL NOT invent subscription-lifecycle or usage events: Hyperswitch's outgoing webhook schema lists `invoice_paid` as its subscription-related event and defines no usage event types. It SHALL acknowledge valid non-terminal or unsupported event types without applying a commerce transition. Event delivery SHALL be idempotent by Hyperswitch event identity, and browser redirects SHALL NOT be treated as proof of payment.

#### Scenario: Valid signed event updates shared commerce state

- **WHEN** Hyperswitch delivers an event with a valid signature for the configured profile
- **THEN** the adapter returns its normalized event and PlatformKit applies the corresponding shared ledger transition

Verified by: `build/hyperswitch-payment-provider.test.mjs` webhook signature and normalization cases

#### Scenario: Invalid signature has no side effects

- **WHEN** an event has a missing or invalid signature, or its body differs from the signed bytes
- **THEN** the webhook is rejected and no commerce state changes

Verified by: `build/hyperswitch-payment-provider.test.mjs` raw-body signature cases

#### Scenario: Hyperswitch retries an event

- **WHEN** Hyperswitch delivers the same event more than once
- **THEN** the duplicate is acknowledged idempotently and the associated order, known subscription invoice, or payout event is applied at most once

Verified by: `build/hyperswitch-payment-provider.test.mjs` duplicate-event cases and `build/payment-provider-db.test.mjs`

#### Scenario: Non-terminal payment event does not grant access

- **WHEN** Hyperswitch delivers a valid `payment_processing`, `payment_authorized`, or `action_required` event
- **THEN** PlatformKit acknowledges the delivery without treating the payment as complete

Verified by: `build/hyperswitch-payment-provider.test.mjs`

### Requirement: Hyperswitch secrets remain server-side and provider-scoped

Hyperswitch API credentials and the webhook signing key SHALL be available only to the server-side adapter. Hyperswitch customer, checkout, payment, subscription, invoice, usage, payout, and event references SHALL remain scoped to the Hyperswitch provider identity so that equal external identifiers from another provider cannot share commerce records or idempotency markers.

#### Scenario: Hyperswitch credentials are not exposed to browser code

- **WHEN** a site is assembled or deployed with Hyperswitch selected
- **THEN** Hyperswitch server credentials are delivered only to the server runtime and are absent from browser-visible configuration and assets

Verified by: `build/payment-provider-registry.test.mjs`, `build/deploy-checks.mjs --test`, and the assembly check

#### Scenario: External identifiers collide across providers

- **WHEN** Hyperswitch and another provider return the same external customer, payment, or event identifier
- **THEN** their records and event processing remain separate by provider identity

Verified by: `build/payment-provider-db.test.mjs`

### Requirement: Hyperswitch preserves the Stripe customer journey

For commerce operations supported by the selected Hyperswitch profile, the site SHALL preserve the same PlatformKit-owned purchase and billing journey as its Stripe provider. The offer, order summary, amount, currency, billing cadence, and other supported checkout terms SHALL remain consistent. Cancellation, pending, error, return, and confirmed-success states SHALL use the same site-owned routes and understandable messaging. The provider-controlled payment-entry form, payment-method choices, branding, redirects, and required authentication or disclosures MAY differ. Raw provider errors SHALL NOT be shown as customer-facing messages, and a browser return SHALL NOT grant access before server-side provider retrieval or an authenticated webhook confirms payment.

#### Scenario: The same offer has the same terms with either provider

- **WHEN** a customer starts checkout for the same offer through Stripe or Hyperswitch
- **THEN** the site presents the same offer identity, order summary, currency, amount, and supported billing terms; a provider that cannot honor a requested term refuses checkout before creating a payment

Verified by: cross-provider checkout contract tests and rendered checkout inspection

#### Scenario: Provider payment-entry surfaces differ

- **WHEN** Stripe and Hyperswitch use different payment forms, wallets, redirects, or authentication steps
- **THEN** the site retains the same surrounding checkout context, cancellation destination, and post-payment return behavior, while allowing only those provider-specific payment-entry differences

Verified by: Stripe checkout regression tests, Hyperswitch checkout tests, and rendered checkout inspection

#### Scenario: Payment status and errors remain understandable

- **WHEN** a provider reports a pending, failed, canceled, or action-required payment, or returns a provider-specific error
- **THEN** the customer receives the corresponding site-owned status and next step without raw provider error text, and access is granted only after verified completion

Verified by: Hyperswitch checkout-state tests and webhook/confirmation tests

#### Scenario: Billing self-service remains familiar

- **WHEN** a customer manages a subscription through Stripe or Hyperswitch
- **THEN** the site uses the same PlatformKit billing route, subscription summary, action labels, and result messaging for the operations supported by the selected provider

Verified by: shared billing-page tests and provider subscription tests
