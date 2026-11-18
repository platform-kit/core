## ADDED Requirements

### Requirement: The kit calls Stripe at one current API version

The kit SHALL call Stripe at one API version, `2026-10-28.endive`, written in one place and used by the Stripe client and by every direct Stripe request the kit or its tests make. The Stripe library's major version SHALL be the one that pins that API version.

#### Scenario: Every Stripe request carries the kit's version

- **WHEN** the kit's Stripe client or a test's direct request calls Stripe
- **THEN** the request is made at `2026-10-28.endive`

Verified by: `build/stripe-payment-provider.test.ts` version check

#### Scenario: A subscription in flexible billing mode can be changed

- **WHEN** a subscription created at Stripe's current default (flexible billing mode) is moved to a new price at its next renewal
- **THEN** the change is made, and Stripe shows the new price from the renewal

Verified by: `build/payment-plans-repricing.test.mts` in Stripe test mode

### Requirement: The Stripe adapter reads an object the same at the current and the previous version

The Stripe adapter SHALL read a subscription's billing period from its items, an invoice's subscription from its `parent`, and an invoice line's price from its `pricing`, falling back to where `2024-06-20` put each one. An event sent to a webhook endpoint still on the old version SHALL be normalised the same as one sent at the current version.

#### Scenario: A subscription's period comes from its item

- **WHEN** the adapter snapshots a subscription whose billing period is on its item
- **THEN** the snapshot's period start and end are the item's

Verified by: `build/stripe-payment-provider.test.ts`

#### Scenario: A paid invoice is read at either version

- **WHEN** an `invoice.paid` event arrives with its subscription under `parent` and its line's price under `pricing`, or with both in their old places
- **THEN** the event names the same subscription, offer and billing period either way

Verified by: `build/stripe-payment-provider.test.ts`

### Requirement: Checkout and plan changes use the current parameters

Checkout SHALL restrict payment methods with `allowed_payment_method_types`. A plan change at the next renewal SHALL set the new phase's length with `duration`, one interval of the new price.

#### Scenario: A checkout restricted to some payment methods

- **WHEN** a checkout allows only some payment methods
- **THEN** the Checkout Session is created with `allowed_payment_method_types` and not `payment_method_types`

Verified by: `build/stripe-payment-provider.test.ts`, and a real test-mode checkout in `build/stripe-testmode.integration.mts`

#### Scenario: A plan change at the next renewal

- **WHEN** a member switches plan to take effect at the next renewal
- **THEN** the subscription schedule's second phase has a `duration` of one interval and no `iterations`

Verified by: `build/stripe-payment-provider.test.ts`, and `build/payment-plans-repricing.test.mts` in Stripe test mode

### Requirement: The check names a webhook endpoint on an older version

`platformkit check` SHALL report, as a warning, each of the site's Stripe webhook endpoints whose API version is older than the kit's, with how to move it.

#### Scenario: An endpoint still on 2024-06-20

- **WHEN** the site's Stripe account has a webhook endpoint at `2024-06-20`
- **THEN** the check warns about that endpoint, names the version the kit uses, and says where to change it

Verified by: `build/check.test.mts`
