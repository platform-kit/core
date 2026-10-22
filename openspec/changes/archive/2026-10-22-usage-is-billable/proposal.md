# Proposal

## Why

Paid work is currently billable only where particular assistant surfaces were wired for it, leaving other provider calls able to bypass the same access controls. Add one reusable, fail-closed server-side usage gate that authorizes and reserves credit or verifies an active usage subscription before any configured billable invocation can spend money.

## What Changes

- Offers may define named units, prepaid grants, or Stripe-metered subscriptions; stable offer keys preserve attribution when names or prices change.
- Any server-side operation may use the shared gate, independent of page, module, bot, or provider. It derives identity and billing terms from trusted server context, reserves bounded prepaid usage or verifies an active subscription before paid work, then settles actual usage once.
- A site may enable automatic top-up in its configuration and make selected prepaid offers eligible. Readers explicitly opt in, choose their own refill threshold and eligible pack, and set their own recurring spend cap; the site owner does not set a reader's cap.
- Bots, agents, and TTS become consumers of the shared gate. Long-running work obtains further authorization before exceeding its reservation; denied work makes no paid provider call.
- Voice reports speech-to-text and text-to-speech usage; speculative work is visible to the site but is not charged to the person.
- Readers can see and replenish their balance, manage automatic top-up, and control their own auto-top-up spend from a dedicated, platform-wide usage page, not inside chatbot conversations. Administrators can compare measured serving cost with the unit's sale price.
- No tiered pricing, consumed-unit refunds, or separate invoicing engine. Calls not configured for usage billing retain their existing behavior.

Purpose of the following copy: show a person their balance and what to do when it is empty.

> Your usage
> {used} used · {remaining} left
> You're out of units.
> Buy more units

All four strings are defaults in theme markdown and may be overridden by a site.

## Capabilities

### New Capabilities

- `store-pricing`: site-defined usage units, prepaid offers, and Stripe-metered offers.
- `bots`: bots use the shared gate for optional offer-based billing and return an editable out-of-units response.
- `copilot`: speech usage uses the shared gate alongside assistant model usage.

### Modified Capabilities

- `platform-data`: a reusable invocation gate, atomic usage reservations, append-only idempotent usage and grant records, and derived balances.

## Impact

Offer schemas and catalog; Stripe price reconciliation and usage reporting; agent and speech functions; declared database schemas and RLS; reader and admin interfaces; theme strings; docs-site guides and references. Existing offers and unbilled bots retain current behavior.
