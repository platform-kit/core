# Design

## Principle: add to what exists

Every moving part already exists. A term is a small record beside them.

- **Access** stays in `entitlements`. A pay-in-full term is a purchase whose tier entitlement expires at the end of the term. A monthly term uses the subscription's entitlement, as today. Restricting access sets the entitlement inactive, and paying sets it active again. `get_my_entitlements` and every gate reading it are unchanged.
- **Monthly charging** stays with the subscription: Stripe's own renewal for Stripe, and the kit's existing `payment_subscription_renewal_*` run for Hyperswitch. Both already report each payment to the kit. A term counts those reports. It doesn't charge anything itself.
- **Paying in full** is the existing one-off checkout, so Klarna, Affirm and the rest come from the provider's own one-off methods.
- **Cancelling bookings** uses the existing `cancelBooking` (`_shared/booking.ts`), which already dispatches to the in-house scheduler or to cal.com by the booking's `provider`. A term never addresses a scheduler by name.

## The one new record: `membership_terms`

One row per term a member is in:
- `user_id`, `sku`, `months`, `plan` (`full` | `monthly`);
- `payments_total`, `payments_made`;
- `starts_at`, `ends_at`, `then` (`end` | `monthly` | `renew`);
- `status` (`active` | `restricted` | `defaulted` | `ended`);
- `restricted_at`, `owed_minor`;
- the `subscription_id` or `purchase_id` it rides on.

It is its own record because a term has its own lifecycle (committed, restricted, defaulted, ended) that a subscription row doesn't have. Grants are declared in its schema file. A member reads only their own rows; administrators read all rows; the service role writes.

## Product file

```yaml
kind: membership
tier: tier-3
rank: 3
billing: subscription      # still needed when the membership also has an open-ended price
period: monthly
price: 2000                # optional when terms are given
terms:
  - months: 3
    full: 13500
    monthly: 5000
  - months: 6
    full: 25000
    monthly: 4600
    then: monthly
  - months: 12
    full: 45000
changes:                   # optional; default anytime / anytime, today's behaviour
  upgrade: anytime         # anytime | term-end | never
  downgrade: term-end
```

The build refuses:
- a term with neither `full` nor `monthly`;
- two terms of the same length;
- a `months` that isn't a whole number from 1 up;
- an unknown `then` or `changes` value;
- a membership with neither a price nor terms;
- a monthly plan on a site whose payment provider lacks `checkout.subscription`.

A membership with terms and no open-ended price is allowed, which relaxes today's "a membership is billing: subscription".

## Flows

- **Checkout:** the request names `term` and `plan`. The server reads the prices from the catalogue (the server decides what a buyer pays). The checkout shows the commitment text and requires its acceptance.
  - `full`: a one-off payment, then a purchase, a tier entitlement expiring at `ends_at`, and a term row.
  - `monthly`: a subscription at the term's monthly price, with the term's `payments_total` recorded.
- **Payment reported paid:** `payments_made` goes up. A restricted term is restored, and its entitlement made active. On the last payment, `then` decides:
  - `end`: the subscription is set to end at the period end, through the existing subscription change;
  - `monthly`: the subscription continues at the open-ended price;
  - `renew`: a new term row starts.
- **Payment reported failed:** the term becomes `restricted`, its entitlement inactive, and the three people are emailed.
- **The scheduled job** (memberships module, every 15 minutes):
  - Restricted for 24 hours or more: every upcoming booking of that member's is cancelled through `cancelBooking` as an administrator, with the reason recorded, and with no refund.
  - When the provider gives up retrying (Stripe's subscription becomes unpaid or cancelled; the Hyperswitch renewal becomes exhausted): the term becomes `defaulted`, `owed_minor` is set, and administrators are told.
  - Before `ends_at`, a renewal reminder is sent where `then` is `end`.
- **Cancelling mid-term:** the kit's own cancel paths refuse while a monthly term is active. Stripe's portal session is created from a configuration without cancellation for such a member. Hyperswitch's portal is checked in task 1.3. If it can't hide cancellation, the kit's own billing view is the only way to manage a committed plan for that provider.
- **Pay in full, then continue:** where `then` is `monthly` or `renew`, checkout saves the payment method. At `ends_at`, the continuation starts as a subscription on that saved method: a Stripe subscription with its first period at `ends_at`, or a Hyperswitch renewal row due then.

## Not done

- No billing engine in the kit.
- No scheduler-specific code.
- No change to products without terms.
- Recovering an unpaid balance beyond the provider's retries is outside the software: the balance is recorded and shown.
