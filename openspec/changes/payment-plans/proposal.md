# Proposal

## Why

A site can sell an offer for one price or as an open-ended subscription, and nothing in between. It can't sell a $4,500 programme as "pay in full, or three payments of $1,600", or a membership as a 3-, 6- or 12-month term the buyer commits to. Payment plans and fixed terms are how coaching, courses, cohorts and mentorships are usually sold. Without them, a site has to bend a subscription or hand-roll billing.

## What Changes

- **Any offer may have payment plans:** pay in full, or a set number of monthly payments at a price the site writes. The markup on paying over time is the site's, never computed.
- **A payment plan is a commitment.** The buyer accepts it at checkout, and it can't be cancelled until the last payment is made.
- **A membership may be sold in fixed terms**, as many as it likes (3, 6, 12 months…), each with its own prices, all in one product file. A term is a payment plan that also grants the tier for its length.
- **What follows a term is the site's choice**: it ends, it continues monthly, or it renews.
- **Changing plan mid-term follows the site's policy**: upgrades and downgrades each allowed any time, only at the end of the term, or never.
- **What a missed payment does is the site's choice**, per offer: when access stops, and whether the buyer's upcoming bookings are cancelled without refund after a grace period. The buyer, their hosts and the site's administrators are told.
- **Paying in full can use whatever the payment provider offers for one-off payments**, including Klarna and Affirm where they are switched on.
- **Nothing changes for an existing offer.** An offer with no plans or terms behaves exactly as today.

## Capabilities

### New Capabilities

- `payment-plans`: payment plans on any offer, fixed membership terms, what follows a term, plan changes, and missed payments.

## Impact

- The catalogue (`packages/kit/build/catalog.mts`): `plans` on any offer; `terms` and `changes` on a membership; `missed` wherever there are plans or terms.
- Checkout (`create-checkout-session`): a plan or term, priced by the server.
- One new table for a buyer's commitment, with its grants declared beside it. Access keeps coming from `entitlements`.
- The Stripe webhook and the Hyperswitch renewal run each report a commitment's payments. One scheduled job.
- The sessions module cancels bookings when a commitment's grace period ends. A site with sessions off has no such rule.
- The Pricing section, the store's offer page, the account's billing view and the admin's view of a person.
- Emails with editable strings.
- The documentation's selling pages.
