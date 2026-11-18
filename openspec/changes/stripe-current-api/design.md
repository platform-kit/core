# Design

## One version, written once

`lib.ts` exports `STRIPE_API_VERSION = '2026-10-28.endive'`. The client is built with it, and anything that calls Stripe outside the client, such as a test's raw `fetch`, sends it as `Stripe-Version`. The library's major version matches it (`stripe@23` pins `2026-10-28.endive`), so the library's types describe the objects that actually arrive.

## What moved, and where the adapter reads it

Each change below is from Stripe's changelog, and each was checked against the kit's code. The kit reads Stripe objects only inside the adapter (`stripe-payment-provider.ts`). Everything else sees the adapter's normalised snapshots, so only the adapter changes.

| Stripe change | Version | The kit's use | Now |
|---|---|---|---|
| `current_period_start`/`_end` moved to subscription items | basil | the subscription snapshot; the end date of a plan change's first phase | item first, then the subscription |
| `Invoice.subscription` moved to `parent.subscription_details.subscription` | basil | the invoice snapshot; the webhook's subscription id for invoice events | `parent` first, then the old field |
| `InvoiceLineItem.price` moved to `pricing.price_details.price` | basil | the invoice lines' price and offer | `pricing` first, then `price` |
| `Invoice.payment_intent`, `charge` and `paid` removed | basil | none: invoice events are keyed by invoice and subscription | nothing |
| Checkout `shipping_details` moved to `collected_information` | basil | already read from both | nothing |
| Legacy usage records removed | basil | none: usage already uses Billing Meters | nothing |
| Subscription schedule `iterations` removed | clover | a plan change at the next renewal | `duration` of one of the new price's intervals |
| Flexible billing mode is the default for new subscriptions | clover | none at the old version: the kit couldn't change them | supported |
| `Discount.coupon` moved to `source` | clover | none: the kit's promotions are its own | nothing |
| `payment_method_types` removed from Checkout Sessions | endive | the payment methods a checkout allows | `allowed_payment_method_types` |

## Why read both shapes

A webhook event is rendered at the version of the endpoint it is sent to, and the site owner sets that version in Stripe's dashboard. Until they move it, events arrive in the old shape while the kit's own calls get the new one. The adapter reads the new place first and falls back to the old. A site that hasn't moved its endpoint keeps working, and `platformkit check` tells the owner to move it.

## Not done

- The kit does not create or update webhook endpoints. The site owner owns them.
- Nothing about Hyperswitch changes.
