# Proposal

## Why

PlatformKit's payment behavior is currently coupled to Stripe across checkout, subscriptions, order reconciliation, catalog publishing, usage billing, and payouts. Sites need to supply their own provider-specific code for every processor operation while PlatformKit keeps shared checkout orchestration, ledger, and entitlement workflows.

## What Changes

- Define a provider-neutral contract covering every processor operation used by the platform: customer and checkout creation, subscription changes, portal sessions, catalog synchronization, refunds, usage reporting and top-ups, connected-account onboarding, readiness checks and payouts, and webhook verification and event normalization.
- Move existing Stripe SDK calls behind a Stripe adapter and route all payment workflows through the contract without changing current Stripe behavior.
- Keep Stripe as the only built-in provider and compatibility default.
- Let a site implement and register a complete server-side adapter through the site module extension model. A site adapter supplies code for each operation it declares, its capabilities, webhook handling, and required secrets, without modifying PlatformKit.
- Configure one active payment provider per site. Refuse an operation before redirecting or charging when the selected adapter cannot meet its requirements.
- Store processor references and webhook idempotency in a provider-scoped, provider-neutral form, preserving existing Stripe records and behavior through migration or compatibility reads.
- Preserve Markdown product files as the source of truth and retain the existing Markdown-to-`catalog.json`-to-Stripe push. Other adapters implement catalog synchronization when needed or declare it unavailable; they never replace site offer terms with provider catalog data.
- Require capability checks before side effects. A site adapter may implement any provider, but must refuse unsupported operations rather than silently changing terms.
- This change does not ship built-in Chargebee, Recurly, Braintree, Adyen, or other non-Stripe adapters; processor failover; simultaneous provider routing; or automatic migration of live customers and subscriptions.

## Capabilities

### New Capabilities

- `payment-providers`: a common contract that lets sites register complete site-owned payment adapters alongside the built-in Stripe adapter, declare capabilities, synchronize the site catalog, and safely reject unsupported operations.

### Modified Capabilities

- `platform-data`: preserve payment ownership and idempotency across providers without losing existing Stripe-backed purchases, subscriptions, or usage records.

## Impact

Checkout and portal functions; order and subscription reconciliation; customer and subscription references; Markdown catalog publication; usage billing and metering; Connect payouts; site module registration, deployment secrets, webhook routes, tests, and payment-provider documentation. Existing Stripe journeys remain unchanged. No new reader-facing copy is proposed.
