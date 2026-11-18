# Proposal

## Why

A membership can only be sold as an open-ended monthly or weekly subscription. A site can't sell a coaching programme for a set term, such as three months for one price, paid in full or monthly, where the buyer commits to the whole term. Programmes like that are how coaching, cohorts and mentorships are usually sold. Without them, a site has to bend a subscription or hand-roll billing.

## What Changes

- **A membership may offer fixed terms**, as many as it likes (3, 6, 12 months…), each with its own prices, all in the one product file.
- **Each term may be paid in full, monthly, or either**, with the site setting both prices, so the markup on paying monthly is the site's.
- **The buyer chooses a term and a way to pay at checkout**, and accepts the commitment before paying.
- **A monthly term commits the buyer to every payment.** It can't be cancelled until the last one is paid.
- **What follows a term is the site's choice**: it ends, it continues monthly, or it renews for another term.
- **Changing plan mid-term follows the site's policy**: upgrades and downgrades each allowed any time, only at the end of the term, or never.
- **A missed payment restricts access at once and is announced** to the member, their coach or provider, and the site's administrators. Paying restores access. Still unpaid 24 hours later, the member's upcoming bookings are cancelled without refund, whichever scheduler holds them.
- **Paying in full can use whatever the payment provider offers for one-off payments**, including Klarna and Affirm where they are switched on.
- **Nothing changes for an existing product.** A membership with no terms behaves exactly as today.

## Capabilities

### New Capabilities

- `fixed-term-memberships`: terms, how they're paid, what follows them, plan changes, and missed payments.

## Impact

- The catalogue (`packages/kit/build/catalog.mts`): `terms` and `changes` on a membership.
- Checkout (`create-checkout-session`): a term and a way to pay, priced by the server.
- One new table for a member's term, with its grants declared beside it. Access keeps coming from `entitlements`.
- The Stripe webhook and the Hyperswitch renewal run each report a term's payments. The memberships module gains one scheduled job.
- The Pricing section, the account's billing view and the admin's view of a person.
- Three emails, all with editable strings.
- The documentation's selling pages.
