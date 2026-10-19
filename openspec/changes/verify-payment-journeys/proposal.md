# Proposal

## Why

PlatformKit's payment rules are well tested piece by piece: the ledger's decisions, a payment arriving twice, promotions racing for a budget, unsigned webhooks refused, and each Stripe operation against Stripe's test mode. Nothing proves a whole journey: a buyer pays, Stripe tells the site, the ledger records it, and access appears; or the reverse, when a renewal fails or a payment is refunded. And nothing notices when the site's ledger and Stripe's records drift apart, for example after a webhook that never arrived.

## What Changes

- An opt-in suite runs each money journey against Stripe's test mode and the local stack, from payment to what the buyer can then do on the site:
  - a one-off purchase, a guest purchase, and the files it unlocks;
  - a subscription, a free trial, an upgrade that takes effect now, a downgrade at renewal, and cancel and resume;
  - a renewal that fails, marking the membership as needing attention, then access ending when the subscription does;
  - a refund removing the access it bought;
  - the same Stripe event delivered twice changing nothing;
  - the usage page's Stripe.js verification step, in a real browser.
- A nightly check compares the site's ledger with Stripe's records for recent payments, refunds and subscriptions, and lists every difference for administrators on the Payments screen.

Proposed copy for the Payments screen. The heading names the problem, the line says what to do, and each row says what differs:

> **Out of step with Stripe**
> These records differ between the site and Stripe. Check each one in the Stripe Dashboard before changing anything.

> Paid at Stripe, missing here · Refunded at Stripe, still granted here · Different amount · Different status · Here, but not at Stripe

When nothing differs:

> The site and Stripe agree as of {time}.

## Non-goals

No automatic correction: the check reports, a person decides. No new payment features. Hyperswitch journeys are covered only where its adapter can list its records; elsewhere the screen says it isn't checked.

## What James should look at

Whether differences should only be listed, as proposed, or also notify administrators. And the Stripe test keys the suite needs, including the publishable `pk_test_` key for the browser step.

## Capabilities

### New Capabilities

- `payment-integrity`: payment journeys proven end to end, and the ledger kept in step with the payment provider's records.

### Modified Capabilities

None.

## Impact

- New opt-in integration runner and its browser steps; a scheduled reconciliation job and its function; a list on the admin Payments screen; strings for that list.
- Surfaces to verify: each journey against Stripe test mode; the reconciliation over seeded differences; the Payments screen with and without differences at desktop and mobile in light and dark.
