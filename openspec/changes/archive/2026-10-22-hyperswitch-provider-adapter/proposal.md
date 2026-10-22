# Proposal

## Why

PlatformKit has a normalized payment-provider contract and an existing Hyperswitch adapter, but the adapter still sends key operations through V1 endpoints and falls back to V1 for some V2 operations. That is not a valid integration with the current V2 Router. Correct it to use documented V2 APIs end to end and verify the Stripe checkout through the actual V2 browser flow.

## What Changes

- Correct the built-in, server-side Hyperswitch adapter to use documented V2 Router APIs for every supported operation, with no V1 endpoint calls or fallback.
- Preserve PlatformKit's shared commerce behavior where V2 supports the required payment movement. **BREAKING:** Do not advertise or call V1-only Hyperswitch operations; connected-account payouts remain unavailable until Hyperswitch documents a V2 payout API.
- Preserve the Stripe customer journey across the site-owned store, checkout context, cancellation and return paths, payment status messaging, and billing self-service. Permit provider-specific payment forms, redirects, wallets, authentication steps, and required disclosures without changing the offer or silently changing its terms.
- Use Hyperswitch as the site's single PlatformKit provider. The site configures its Hyperswitch account or instance; Hyperswitch owns processor connectors, routing, and any subscription or payout services configured behind it. PlatformKit does not add separate direct PSP adapters or orchestrate providers alongside Hyperswitch.
- Preserve PlatformKit's shared commerce ledger, idempotency, and offer authority while translating payment movement through Hyperswitch's unified API.
- Where Hyperswitch does not provide a documented native API for a contract operation, keep the behavior in PlatformKit's site-owned commerce layer: offers/catalog remain PlatformKit-owned, recurring billing and usage accounting use the existing shared commerce records, and customer self-service uses PlatformKit routes. These operations SHALL NOT introduce another payment processor; any charge or refund still goes through Hyperswitch.
- Verify all PlatformKit payment capabilities against Hyperswitch's documented API and configured profile/connector capability information. Do not narrow the adapter to one-time payments or hard-code a reduced first-release capability set; the selected Hyperswitch setup must expose the terms a site's enabled commerce features require.
- Update deployment preflight to require Hyperswitch settings only when Hyperswitch is selected, while preserving Stripe as the default.
- Use a V2-compatible Hyperswitch Web SDK flow on the generic PlatformKit checkout page. Keep card entry inside provider-controlled secure fields, keep API credentials server-side, and verify successful payment by retrieving its V2 status. Do not count a V1 API test or a widget-only render as browser-checkout verification.
- Provision the isolated V2 test stack with a test merchant/profile, Stripe test connector, and valid local Vault configuration; complete and refund a Stripe test payment in a real browser before marking the integration verified.
- Keep Stripe as the existing default and preserve its current behavior. Do not deploy Hyperswitch or supply PSP credentials from PlatformKit. Edge Functions call the separately hosted or self-hosted V2 Router; do not run Hyperswitch inside the Edge Runtime.
- Update only the shared checkout and billing surfaces needed for this continuity; keep site-specific merchandising and product copy in the site's editable content.

Hyperswitch's [connector catalog](https://docs.hyperswitch.io/integrations/connectors-integrations/payment-processor-capabilities/available-connectors.md) and [payment processor capability reference](https://docs.hyperswitch.io/integrations/connectors-integrations/payment-processor-capabilities.md) describe broad connector coverage and connector-specific support for payment flows. Public coverage counts vary, so the implementation must validate the required connectors and flows rather than promise an unverified processor count or assume identical behavior from every backend.

## Capabilities

### New Capabilities

- `hyperswitch-payment-adapter`: V2-only PlatformKit payment-provider behavior through Hyperswitch's unified API, with unsupported V1-only operations excluded.

### Modified Capabilities

- `deploy`: require and validate the selected provider's settings, including Hyperswitch settings only when it is selected; preserve Stripe's default checks.

## Impact

Provider registration and server functions, the local V2 test stack, browser integration tests, and payment-provider and environment documentation are affected. No reader-facing copy changes are proposed. Review focus: no V1 API fallback, accurate V2 capability exposure, Vault-safe browser collection, and a successful V2 Router Stripe test payment verified and refunded through the actual browser journey.
