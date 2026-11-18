# Design

## Principle: one mechanism, added to what exists

A payment plan is a commitment: N payments, owed in full. A membership term is the same commitment plus a tier for a length of time. So there is one mechanism, used by every offer, and memberships add only what is theirs: the tier, what follows the term, and the plan-change policy.

Every moving part already exists. A commitment is a small record beside them.

- **Access** stays in `entitlements`. Paying in full is an ordinary purchase. A plan grants the offer's entitlement (a course, a class, a book, a tier) at its first payment. A term's entitlement expires at the end of the term. Restricting access sets the entitlement inactive, and paying sets it active again. `get_my_entitlements` and every gate reading it are unchanged.
- **Monthly charging** stays with subscriptions: Stripe's own renewal for Stripe, and the kit's existing `payment_subscription_renewal_*` run for Hyperswitch. Both already report each payment to the kit. A commitment counts those reports and ends the subscription after its last payment. It doesn't charge anything itself.
- **Paying in full** is the existing one-off checkout, so Klarna, Affirm and the rest come from the provider's own one-off methods.
- **Cancelling bookings** belongs to the sessions module, which already owns bookings and `cancelBooking` (`_shared/booking.ts`, dispatching to the in-house scheduler or cal.com by the booking's `provider`). A site with sessions off has no booking rule, and no code reaches for one.

## The one new record: `commitments`

One row per plan or term a buyer is in:
- `user_id`, `sku`, `plan` (`full` | `monthly`), `term_months` (null for a plain plan);
- `payments_total`, `payments_made`, `amount_minor`, `currency`;
- `starts_at`, `ends_at` (a term only), `then` (`end` | `monthly` | `renew`, a term only);
- `status` (`active` | `restricted` | `defaulted` | `ended`);
- `missed_at`, `owed_minor`;
- the `subscription_id` or `purchase_id` it rides on, and the entitlement it controls.

It is its own record because a commitment has its own lifecycle (committed, restricted, defaulted, ended) that a subscription or purchase doesn't have. Grants are declared in its schema file: a buyer reads only their own rows, administrators read all rows, and the service role writes.

## Product files

Any offer sold for one price may add plans. Prices are in the file's currency, like `price`.

```yaml
kind: course
price: 4500                # paying in full
plans:
  - payments: 3
    each: 1600
missed:                    # optional; these are the defaults
  restrict: immediately    # immediately | after-retries | never
  cancelBookings: off      # off | a grace period, such as 24h or 3d
```

A membership may add terms. Each term may be paid in full, monthly, or either.

```yaml
kind: membership
tier: tier-3
rank: 3
billing: subscription      # needed only when the membership also has an open-ended price
period: monthly
price: 2000                # optional when terms are given
terms:
  - months: 3
    full: 5400
    monthly: 2000
  - months: 6
    full: 10000
    monthly: 1800
    then: monthly          # end (default) | monthly | renew
  - months: 12
    full: 18000
changes:                   # optional; the default is anytime / anytime, today's behaviour
  upgrade: anytime         # anytime | term-end | never
  downgrade: term-end
missed:
  restrict: immediately
  cancelBookings: 24h
```

The defaults are the gentlest that still protect the seller: access stops at a missed payment, and nothing is cancelled unless the site asks. Cancelling bookings after 24 hours is a site's setting, as in the second example, not the kit's behaviour.

The build refuses:
- a plan with fewer than two payments, or a price that isn't a positive amount;
- a term with neither `full` nor `monthly`, two terms of the same length, or a `months` that isn't a whole number from 1 up;
- `plans` on a subscription, or on an offer that ships (a physical order can't be taken back; Klarna and Affirm cover paying over time there);
- `terms` or `changes` on anything but a membership;
- an unknown `then`, `changes`, `restrict` or `cancelBookings` value;
- a membership with neither a price nor terms;
- a plan or monthly term on a site whose payment provider lacks `checkout.subscription`;
- `cancelBookings` on a site with the sessions module off.

A membership with terms and no open-ended price is allowed, which relaxes today's "a membership is billing: subscription".

## Flows

- **Checkout:** the request names a plan or a term and how it's paid. The server reads the prices from the catalogue (the server decides what a buyer pays). The checkout shows the commitment and requires its acceptance.
  - Paid in full: a one-off payment, then a purchase, the entitlement (expiring at `ends_at` for a term), and a commitment row for a term.
  - Paid monthly: a subscription at the plan's or term's monthly price, set to end after `payments_total` payments, and a commitment row.
- **Payment reported paid:** `payments_made` goes up. A restricted commitment is restored, and its entitlement made active. On the last payment of a plain plan, the subscription ends and the entitlement stays, as a purchase would. On the last payment of a term, `then` decides:
  - `end`: the subscription ends at the period end, through the existing subscription change;
  - `monthly`: the subscription continues at the open-ended price;
  - `renew`: a new commitment starts.
- **Payment reported failed:** `missed_at` is set. With `restrict: immediately`, the commitment becomes `restricted` and its entitlement inactive. The buyer and the administrators are emailed, and so is each host of the buyer's upcoming bookings where the sessions module is on.
- **The scheduled job** (every 15 minutes, beside the existing renewal run):
  - When the provider gives up retrying (Stripe's subscription becomes unpaid or cancelled; the Hyperswitch renewal becomes exhausted): the commitment becomes `defaulted`, `owed_minor` is set, access stops unless `restrict` is `never`, and administrators are told.
  - Before `ends_at`, a renewal reminder is sent where `then` is `end`.
- **The sessions module's rule:** where an offer's `cancelBookings` is a grace period, a commitment unpaid for that long has every upcoming booking of the buyer's cancelled through `cancelBooking` as an administrator, with the reason recorded and no refund. It is declared in the sessions module, reading `commitments`, so it is absent when sessions is off.
- **Cancelling and switching plan mid-term, by provider** (checked 2026-11-17):
  - **Hyperswitch** has no hosted portal. The adapter's `createPortalSession` returns the kit's own `/billing` page, and cancelling is the `cancel` action of `create-portal-session`, which writes `cancel_at_period_end` on the kit's own row. That action refuses while a commitment is active, and plan changes go through `changes` there too. Nothing outside the kit can cancel.
  - **Stripe**'s portal session takes a `configuration` ID (stripe 17.7: "If not specified, the session uses the default configuration"). A configuration's `features.subscription_cancel.enabled` turns cancellation off, and `features.subscription_update` controls plan switching. For a buyer in an active commitment, the session is created from a kit-managed configuration with both off: plan changes then go through the kit, where `changes` applies. The configuration is created once through the API and its ID kept with the provider's refs. Everyone else keeps the default configuration, as today.
  - **The backstop for both:** a subscription ended any other way mid-commitment (by an administrator in the provider's dashboard, say) arrives as the provider's ordinary deletion report. The commitment then ends early, with the remaining payments recorded as owed, and administrators are told.
- **A term paid in full, then continued:** where `then` is `monthly` or `renew`, checkout saves the payment method. At `ends_at`, the continuation starts as a subscription on that saved method: a Stripe subscription with its first period at `ends_at`, or a Hyperswitch renewal row due then.

## Not done

- No billing engine in the kit.
- No scheduler-specific code.
- No change to offers without plans or terms.
- Payments are monthly only. Weekly or custom intervals can be added to `plans` later without changing the record.
- Recovering an unpaid balance beyond the provider's retries is outside the software: the balance is recorded and shown.
