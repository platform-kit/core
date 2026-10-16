# Spec Delta

## Purpose

The Prism payment connector lets PlatformKit sites use supported processors directly through Prism while retaining native Stripe and avoiding a Hyperswitch account or instance.

## ADDED Requirements

### Requirement: Prism reaches the configured processor directly

When a site selects Prism, payment operations SHALL use only the explicitly configured, supported connector through Prism. Prism configuration SHALL include the connector identity and its required server-side credentials. An unknown or unverified connector SHALL fail before a provider request; PlatformKit SHALL NOT route through Hyperswitch or silently fall back to Stripe.

#### Scenario: A site selects a supported Prism connector

- **WHEN** a site selects Prism and configures a connector declared as supported
- **THEN** supported operations reach that processor through Prism without requiring a Hyperswitch account, profile, or instance

Verified by: Prism provider registry and Edge Function Prism/WASM contract tests

#### Scenario: A site selects an unknown or unverified connector

- **WHEN** the selected Prism connector has no verified PlatformKit capability declaration
- **THEN** configuration or deployment fails clearly and no connector request or fallback occurs

Verified by: `packages/kit/build/payment-providers.test.mjs` and `packages/kit/build/deploy-checks.mjs --test`

### Requirement: Prism executes entirely within Supabase Edge Functions

Prism request transformation, response normalization, webhook verification, and payment orchestration SHALL execute inside the site's Supabase Edge Functions. A site SHALL NOT need a separate Node process, Prism gateway, gRPC server, or other payment service to use Prism.

#### Scenario: A Prism payment runs with only Edge Function deployment

- **WHEN** a site deploys the Prism-enabled Edge Functions with the selected connector's server-side credentials
- **THEN** the function performs Prism transformation and sends the resulting request directly to the selected processor without calling a separate Prism or Node service

Verified by: Prism Edge Function runtime tests and the function bundle check

### Requirement: Prism exposes only verified connector capabilities

For each supported connector, PlatformKit SHALL advertise only operations whose request, response, webhook, and idempotency behavior has been verified. Before any provider-side effect, the payment workflow SHALL check that the configured connector supports every feature required by the action. Unsupported checkout, recurring payment, subscription change, tax, catalog, refund, payout onboarding, account readiness, or transfer operations SHALL fail before a provider request or ledger claim. Prism mandates alone SHALL NOT be represented as Stripe subscriptions, schedules, proration, or a billing portal.

#### Scenario: An action requires an unimplemented connector capability

- **WHEN** an offer or action requires a capability absent from the connector's verified declaration
- **THEN** the action is refused before provider or ledger side effects and the error identifies the unsupported capability

Verified by: `packages/kit/build/payment-providers.test.mjs`, `packages/kit/build/checkout-params.test.mjs`, and payout database tests

#### Scenario: A connector lacks secure payout enrollment

- **WHEN** payout onboarding would require a PlatformKit form to collect sensitive bank details and the connector supplies no secure hosted enrollment
- **THEN** the payout capability is unavailable and PlatformKit collects no bank details or attempts no payout

Verified by: Prism provider capability tests and payout database tests

### Requirement: Prism checkout does not collect raw payment credentials

Prism checkout SHALL use a connector-supported hosted or redirect flow. PlatformKit SHALL construct payment amounts from its server-validated site offer data and SHALL NOT accept client-supplied amounts, collect raw card details, or treat a processor catalog as the site's source of truth.

#### Scenario: A buyer checks out with Prism

- **WHEN** a buyer requests an offer through a connector that supports secure hosted checkout
- **THEN** PlatformKit uses the site's declared amount and currency and redirects the buyer to the connector's hosted flow without collecting raw card details

Verified by: Prism provider contract tests and rendered checkout redirect/error states

#### Scenario: A connector offers no safe checkout flow

- **WHEN** the selected connector requires raw card entry in PlatformKit and offers no secure hosted or redirect flow
- **THEN** checkout is rejected before creating a payment

Verified by: Prism provider capability tests

### Requirement: Retiring Hyperswitch preserves payment history

PlatformKit SHALL NOT select, configure, or send new payment operations through its former built-in Hyperswitch provider. Removing that provider SHALL preserve historical payment, ledger, and reference records without replaying or deleting them. Historical Hyperswitch identifiers SHALL NOT be reinterpreted as Stripe or Prism identifiers.

#### Scenario: Hyperswitch support is removed from a site

- **WHEN** the site deploys without the built-in Hyperswitch provider
- **THEN** historical records remain intact and no Hyperswitch renewal or payment job runs

Verified by focused migration tests using a fixture with historical Hyperswitch records

#### Scenario: A site has an existing Hyperswitch recurring agreement

- **WHEN** the site retires Hyperswitch while an agreement or payment token remains at the old processor
- **THEN** PlatformKit does not renew it or move its token to Stripe or Prism, and the migration instructions require the site owner to arrange a manual transition

Verified by migration tests and the payment-provider documentation review
