---
title: Providers and payouts
description: How a site lets providers offer their own services, agree to terms, and see earnings and payouts.
order: 21
sources:
  [
    packages/kit/build/providers-io.mjs,
    packages/kit/build/providers-push.mjs,
    packages/kit/src/lib/payouts.js,
    packages/kit/supabase/functions/providers,
    packages/kit/supabase/functions/payouts,
    packages/kit/supabase/functions/_shared/payouts.ts,
    packages/kit/supabase/functions/_shared/payment-provider.mjs,
    packages/kit/src/payment-provider.d.ts,
    packages/kit/supabase/schemas/57-providers.sql,
  ]
reviewed: 2026-10-19
---

A provider is a person who offers their own service through the site. It is different from a store product: the offering belongs to the provider, is booked rather than added to the shopping bag, and its money is tracked against the person who earned it. The site may turn provider offerings on or off, require approval before they appear, set a delay before earnings become payable, and choose how providers connect a payout account.

## Participation and terms

The site-wide provider policy is kept in the provider settings record. Its terms are shown to providers before they offer services. When the terms change, the new version is kept as a separate agreement; a version someone has already accepted is not silently rewritten. If offering services requires approval, a new offer remains unavailable until staff approve it.

Providers connect their own payout account through the payment processor. The account belongs to the provider; staff can review payout status but cannot send that person's earnings to themselves. Sites can use managed or provider-owned account connections according to their policy.

Stripe is the built-in default. A site-owned adapter can provide these flows through the
`payouts.connected-accounts` capability; an adapter without it is refused before payout lines are
claimed. See [Payment providers](/content/docs/building-a-site/payment-providers).

## Earnings and payout status

The site records earnings as separate lines, so a provider can see what each line was for, when it was earned, when it becomes payable, and whether it has been paid. Payout rules decide which activity earns money and how it is calculated: a fixed amount or a share, including rules tied to a booking or a recurring period. A configured holding delay determines when a line can be paid. A refund reverses the related earning proportionally rather than leaving the original amount untouched.

A provider can review their own balance and payout history, connect or refresh their account, and see when a payment is not yet available. Staff can review what is due and issue payouts, but providers cannot trigger a payout to another person or to themselves. This is separate from the site's fulfillment suppliers, which make or ship products; see [Suppliers](/content/docs/reference/suppliers).
