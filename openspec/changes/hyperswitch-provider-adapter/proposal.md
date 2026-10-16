# Proposal

## Why

PlatformKit already has a normalized payment-provider contract modeled on its Stripe adapter. Hyperswitch gives a site one integration boundary across configured payment processors, while the buyer-facing purchase and billing journey should remain familiar when a site selects it instead of Stripe.

## What Changes

- Add a built-in, server-side Hyperswitch adapter that preserves the full capability set exposed by PlatformKit's built-in Stripe adapter: checkout terms, subscriptions, customers, catalog sync, refunds, usage billing, connected-account payouts, and normalized webhooks.
- Preserve the Stripe customer journey across the site-owned store, checkout context, cancellation and return paths, payment status messaging, and billing self-service. Permit provider-specific payment forms, redirects, wallets, authentication steps, and required disclosures without changing the offer or silently changing its terms.
- Use Hyperswitch as the site's single PlatformKit provider. The site configures its Hyperswitch account or instance; Hyperswitch owns processor connectors, routing, and any subscription or payout services configured behind it. PlatformKit does not add separate direct PSP adapters or orchestrate providers alongside Hyperswitch.
- Preserve PlatformKit's shared commerce ledger, idempotency, and offer authority while translating payment movement through Hyperswitch's unified API.
- Where Hyperswitch does not provide a documented native API for a contract operation, keep the behavior in PlatformKit's site-owned commerce layer: offers/catalog remain PlatformKit-owned, recurring billing and usage accounting use the existing shared commerce records, and customer self-service uses PlatformKit routes. These operations SHALL NOT introduce another payment processor; any charge or refund still goes through Hyperswitch.
- Verify all PlatformKit payment capabilities against Hyperswitch's documented API and configured profile/connector capability information. Do not narrow the adapter to one-time payments or hard-code a reduced first-release capability set; the selected Hyperswitch setup must expose the terms a site's enabled commerce features require.
- Update deployment preflight to require Hyperswitch settings only when Hyperswitch is selected, while preserving Stripe as the default.
- Use Hyperswitch's documented Web SDK on a generic PlatformKit-hosted checkout page for payment confirmation, keeping secret API credentials server-side and exposing only the publishable key and single-intent client secret needed by that page. Show the same site-owned order summary and purchase terms as Stripe, while allowing the payment-entry surface itself to differ.
- Keep Stripe as the existing default and preserve its current behavior. Do not deploy Hyperswitch or supply PSP credentials from PlatformKit. Edge Functions call the separately hosted or self-hosted Hyperswitch service over its documented API; do not run Hyperswitch inside the Edge Runtime.
- Update only the shared checkout and billing surfaces needed for this continuity; keep site-specific merchandising and product copy in the site's editable content.

Hyperswitch's [connector catalog](https://docs.hyperswitch.io/integrations/connectors-integrations/payment-processor-capabilities/available-connectors.md) and [payment processor capability reference](https://docs.hyperswitch.io/integrations/connectors-integrations/payment-processor-capabilities.md) describe broad connector coverage and connector-specific support for payment flows. Public coverage counts vary, so the implementation must validate the required connectors and flows rather than promise an unverified processor count or assume identical behavior from every backend.

## Capabilities

### New Capabilities

- `hyperswitch-payment-adapter`: full PlatformKit payment-provider capability coverage through Hyperswitch's unified API and configured backends.

### Modified Capabilities

- `deploy`: require and validate the selected provider's settings, including Hyperswitch settings only when it is selected; preserve Stripe's default checks.

## Impact

Provider registration and server functions, provider-aware deployment checks, focused tests, and payment-provider and operations documentation are affected. There is no new storefront copy. Implementation depends on completing `payment-provider-abstraction` first. Review focus: Stripe-like buyer-journey continuity, full contract coverage, how configured Hyperswitch capabilities are validated, and keeping PlatformKit's provider boundary distinct from Hyperswitch's backend orchestration.
