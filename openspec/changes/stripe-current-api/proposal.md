# Proposal

## Why

The kit calls Stripe at API version `2024-06-20`, through version 17 of Stripe's library. Nothing chose that version. It came with the kit's first snapshot. Stripe has since released three named versions with breaking changes (`basil`, `clover`, `endive`), and the gap grows with each one.

The old version already limits the kit. A subscription made at Stripe's current default, such as one created in the dashboard, uses Stripe's flexible billing mode, and the kit can't change it at `2024-06-20`. Stripe refuses with "you must use a Stripe version that is at least `2025-04-30.preview`." So a price change that moves existing subscribers fails for any subscription the kit didn't create itself.

## What Changes

- The kit calls Stripe at its current version, `2026-10-28.endive`, through Stripe's current library (`stripe@23`). The version is written once, and every call and test uses it.
- The Stripe adapter reads each field Stripe has moved from its new place:
  - a subscription's billing period, from its items;
  - an invoice's subscription, from the invoice's `parent`;
  - an invoice line's price, from its `pricing`.
- The adapter still accepts the old shape, because a site's webhook endpoint keeps its own API version until the site owner moves it. An event sent at either version is read the same.
- Checkout restricts payment methods with Stripe's `allowed_payment_method_types`, which replaced `payment_method_types`.
- A plan change at the next renewal sets the new phase's length with `duration`, which replaced `iterations`.
- `platformkit check` reports a Stripe webhook endpoint whose API version is older than the kit's.
- **Nothing changes for a buyer or a site.** Checkout, subscriptions, plan changes, payment plans, usage billing and payouts behave exactly as they do today.

## Capabilities

### New Capabilities

- `stripe-payment-adapter`: the Stripe API version the kit uses, and how the adapter reads Stripe's objects across versions.

## Impact

- `packages/kit/supabase/functions/_shared/lib.ts`: the client and the version.
- `packages/kit/supabase/functions/_shared/stripe-payment-provider.ts`: subscription and invoice snapshots, checkout, and plan changes.
- `packages/kit/package.json`, `deno-shim.d.ts` and the generated provider registry: `stripe@23`.
- The Stripe tests: the adapter's unit tests, the Stripe test-mode integration tests and the repricing test.
- `platformkit check`: the webhook endpoint's version.
- The documentation's payment-provider page: the version, and moving the webhook endpoint.
