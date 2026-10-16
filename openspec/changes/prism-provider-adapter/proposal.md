# Proposal

## Why

Replace the unfinished built-in Hyperswitch path with native Stripe plus a Prism-backed provider that calls configured processors directly. This avoids operating a Hyperswitch instance while being honest that connector support varies and Prism is not a drop-in replacement for every Stripe Billing feature.

## What Changes

- Add a built-in Prism provider for explicitly configured connectors; keep native Stripe as the default and preserve existing Stripe behavior.
- **Run all Prism code inside Supabase Edge Functions.** Do not add a Node service, sidecar, gRPC server, or other process. Package Prism's Rust request/response transformation core for the Edge runtime; Edge `fetch` is only the transport for Prism-generated connector requests.
- Advertise and allow only connector capabilities actually implemented. Reject unsupported checkout, billing, or payout operations before provider effects; do not claim Stripe-equivalent subscriptions, portal, catalog, or payout onboarding where a connector cannot provide them.
- Remove the built-in Hyperswitch provider, its checkout route, profile configuration, renewal jobs, and provider-specific documentation. Retain historical ledger data; do not route new operations through Hyperswitch.
- Update deployment preflight and webhook trust requirements for Prism, and document the new provider setup.

**Non-goal:** collecting card or bank details in a PlatformKit-hosted form to compensate for a connector's missing hosted flow.

**Review focus:** Prism's supported operations, credentials and webhook integrity remain explicit per connector; Stripe sites remain unchanged.

**Reader-facing documentation**

Purpose: explain provider choices without requiring site owners to operate Hyperswitch.

> PlatformKit supports native Stripe and Prism-backed payment processors. Prism connects directly to the processor you configure; it does not require a Hyperswitch instance.

## Capabilities

### New Capabilities

- `prism-payment-connector`: use Prism to reach configured processors directly, with verified connector capabilities and safe unsupported-operation behavior. This complements the provider-neutral contract in the completed `payment-provider-abstraction` change.

### Modified Capabilities

- `deploy`: require the selected provider's configuration and secrets before deployment, without requiring Stripe credentials for Prism-only sales.
- `edge-functions`: verify and normalize Prism webhooks while preserving Stripe webhook verification.

## Impact

Provider contract and registry; generated payment-provider configuration; Deno payment and webhook functions and their bundled Prism/WASM dependency; payment renewal/schema declarations; deployment checks; checkout and billing routes; demo configuration; payment-provider, deployment, webhook, and environment-variable documentation. Relevant verification includes Edge-runtime compatibility, focused provider, deploy-check, webhook, checkout, payout, ledger, and docs checks. The active `hyperswitch-provider-adapter` change is superseded; its unfinished Hyperswitch delta must not be archived as implemented.
