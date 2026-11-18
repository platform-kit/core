---
title: Payment plans and fixed terms
description: Selling an offer in a set number of payments, or a membership for a fixed term, with the full amount owed.
order: 23
sources:
  [
    packages/kit/build/commitments.mts,
    packages/kit/build/catalog.mts,
    packages/kit/supabase/schemas/44-commitments.sql,
    packages/kit/build/payment-plans.test.mts,
    packages/kit/build/payment-plans-db.test.mts,
    packages/kit/build/payment-plans-checkout.test.mts,
    packages/kit/supabase/functions/_shared/commitments.ts,
    packages/kit/supabase/functions/commitment-bookings,
    packages/kit/supabase/schemas/glue/core+sessions.sql,
    packages/kit/src/lib/payment-plans.ts,
    packages/kit/theme/src/components/store/PlanPicker.vue,
    packages/kit/theme/src/pages/BillingPortalPage.vue,
    packages/kit/build/payment-plans-bookings.test.mts,
    packages/kit/modules/memberships/functions/term-reminders,
    packages/kit/modules/memberships/emails/term-ending.json,
    packages/kit/content/emails/payment-missed.json,
    packages/kit/content/emails/payment-missed-notice.json,
    packages/kit/content/emails/payment-default-notice.json,
  ]
reviewed: 2026-11-17
---

A payment plan sells something for one price, or in a set number of monthly payments at a price you write. A fixed term sells a membership for a number of months, paid in full or monthly. Either way the buyer commits to every payment: the full amount is owed, whether or not they use what they bought.

Both are written in the offer's product file. Nothing changes for an offer that doesn't use them.

## A payment plan

Any offer bought once may add `plans`. Each plan is a number of monthly payments and the price of each. The prices are yours, so the markup on paying over time is too.

```yaml
kind: course
price: 4500 # paying in full
plans:
  - payments: 3
    each: 1600
```

The buyer gets what the offer gives from the first payment, as if they had paid in full.

Plans aren't offered on something that ships, because an order that has been sent can't be taken back. Klarna and Affirm, switched on in your payment provider's dashboard, cover paying over time there.

## A fixed term

A membership may add `terms`, as many as you like. Each term is a number of months, with a price to pay in full, a monthly price, or both.

```yaml
kind: membership
tier: tier-3
rank: 3
billing: subscription
period: monthly
price: 2000 # the open-ended monthly price; leave it out to sell in terms alone
terms:
  - months: 3
    full: 5400
    monthly: 2000
  - months: 6
    full: 10000
    monthly: 1800
    then: monthly
  - months: 12
    full: 18000
```

`then` says what follows a term:

- `end`, the default: the term ends, and so does the membership.
- `monthly`: the membership continues at its open-ended monthly price until it is cancelled.
- `renew`: another term of the same length begins.

`changes` says when a member partway through a term may move to a higher or a lower tier: `anytime` (the default, as for any membership), `term-end`, or `never`.

```yaml
changes:
  upgrade: anytime
  downgrade: term-end
```

## A missed payment

`missed` says what happens when a payment fails. These are the defaults:

```yaml
missed:
  restrict: immediately # or after-retries, or never
  cancelBookings: off # or a grace period, such as 24h or 3d
```

- `restrict` is when access stops: at the failed payment, only once the payment provider stops retrying, or never. Paying gives access back at once.
- `cancelBookings` cancels the buyer's upcoming bookings, without refund, once a payment has been outstanding for the grace period. It needs the sessions module. Bookings cancelled this way stay cancelled after the payment is made.

When the payment provider stops retrying, the rest of the commitment is recorded as owed, and access stays off until it is paid.

## What the build checks

The build refuses a plan with fewer than two payments, a price that isn't above zero, two plans or terms of the same length, a term with no price, a `then`, `changes` or `missed` value it doesn't know, plans on a subscription or on something that ships, terms on anything but a membership, and `cancelBookings` on a site with the sessions module off.

## How it's kept

Each way of paying is compiled into an offer of its own, named after the offer it pays for (`coaching--6m-monthly`, `programme--plan-3`). Your payment provider charges it like any other subscription or one-off payment.

Each buyer's commitment is a row in `commitments`. It counts the payments, holds access back after a missed payment, and records what's owed. While a payment is outstanding, the entitlements the payment wrote are inactive, and a purchase bought in instalments is marked `suspended`. A buyer can read their own commitments. Only the server can write them.

## Buying, paying and cancelling

A plan or a term is bought on its own, and only once the buyer has agreed to it: checkout refuses one without `accept: true`, and charges the catalogue's price for it whatever the request says. A membership sold in terms alone is bought through one of its terms.

Each payment is counted once, whichever report brings it: the Stripe webhook, the Hyperswitch renewal run, or the buyer's own confirmation on landing.

- **A missed payment** holds access back as `missed.restrict` says, and emails the buyer (`payment-missed`) and the administrators (`payment-missed-notice`). Paying gives access back at once.
- **When the provider stops retrying**, or the subscription is ended some other way before the last payment, the rest is recorded as owed and the administrators are told (`payment-default-notice`).
- **The last payment** ends the subscription at the end of the period paid for, moves it to the open-ended price (`then: monthly`), or starts another term (`then: renew`). A plan change the policy deferred is made instead.

A buyer can't cancel while payments are still to make. On Hyperswitch, the site's billing page refuses it. On Stripe, the customer portal opens without cancellation or plan switching for a customer with payments to make. It's a portal configuration the kit makes once in the account, tagged `platformkit-commitment`. Everybody else gets the account's default portal.

## Where it shows

An offer with plans or terms shows its ways to pay on its store page in place of the one button: each way with its price, what the buyer is agreeing to (the number of payments, the total, and what follows a term), and a box to tick before checkout opens. The words are in the store's strings, under `product` → `ui` (`plans-…`). On the Pricing section, point a row at the offer's store page rather than at a sku: a plan or a term is bought only where its terms are shown and agreed to.

The Billing page lists each plan or term the person is in: payments made and left, the amount of each, when a term ends, anything owed, and whether a payment was missed.

## Bookings

With the sessions module on, a missed payment also reaches bookings. The `commitment-bookings` function, run every five minutes, emails the hosts of the buyer's upcoming bookings once. Where the offer names a grace period, it cancels every upcoming booking once the payment has been outstanding that long. The cancellation goes through the ordinary one, so whichever scheduler holds the booking, the person and the host are told. Nothing is given back. Bookings cancelled this way stay cancelled after the payment is made.

## Before a term ends

A week before a membership term that simply ends (`then: end`, with no plan change waiting), the member is emailed once (`term-ending`), with a link back to the membership. The memberships module's `term-reminders` function sends it daily. The same run marks a term paid in full as ended once its date has passed.

Still to come under the OpenSpec change `payment-plans`: continuing a term that was paid in full (`then: monthly` or `renew` after a `full` payment). Until then, a term paid in full ends when it ends, whatever its `then` says.
