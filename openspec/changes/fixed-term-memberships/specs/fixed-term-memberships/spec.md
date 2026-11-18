## ADDED Requirements

### Requirement: A membership may be sold in fixed terms

A membership product SHALL be able to list any number of terms, each a whole number of months with its own prices: a price to pay in full, a monthly price, or both. Both prices SHALL be the site's own, never derived one from the other. A membership MAY offer terms alongside its open-ended price, or terms alone. The build SHALL refuse a term with no price, two terms of the same length, a length that isn't a whole number of months, a value it doesn't know, a membership with neither a price nor terms, and a monthly plan on a site whose payment provider can't run subscriptions. A membership with no terms SHALL behave exactly as before.

#### Scenario: three terms in one product file

- **WHEN** a membership lists a 3-month term with both prices, a 6-month term with both, and a 12-month term with a full price only
- **THEN** the catalogue offers five ways to buy it, each at the price written in the file, and the 12-month term has no monthly option

Verified by: `packages/kit/build/catalog.test.mts`

#### Scenario: an existing membership is untouched

- **WHEN** a membership with no terms is built, bought, renewed and cancelled
- **THEN** every step behaves and is priced exactly as before this change

Verified by: the existing catalogue, checkout and membership tests, unchanged

### Requirement: The buyer chooses a term and a way to pay, and accepts the commitment

Checkout SHALL let the buyer choose one of a membership's terms and, where both are offered, whether to pay in full or monthly. The server SHALL set the price from the catalogue, whatever the request says. Before paying, the buyer SHALL see and accept the commitment: the length of the term, the number and amount of the payments, that a monthly term can't be cancelled before its last payment, and what follows the term.

#### Scenario: a tampered price

- **WHEN** a checkout request names a 6-month monthly plan but carries a lower amount
- **THEN** the buyer is charged the catalogue's monthly price for that term

Verified by: `packages/kit/build/checkout-tamper.test.mts`

### Requirement: Paying in full grants the tier for the term

Paying in full SHALL be one payment that grants the membership's tier from the day of purchase to the end of the term, through the same entitlements that grant every tier. It SHALL accept every one-off payment method the payment provider offers the site, Klarna and Affirm included where they are switched on.

#### Scenario: a 3-month term paid in full

- **WHEN** a buyer pays a 3-month term in full
- **THEN** they hold the tier from that day until three months later, and lose it then unless the term continues

Verified by: `packages/kit/build/fixed-terms-db.test.mts`

### Requirement: A monthly term commits the buyer to every payment

A monthly term SHALL charge its monthly price once a month, through the site's subscriptions, until the term's number of payments is made. The member SHALL NOT be able to cancel it before then, or change plan except as the membership's change policy allows, in the site's own screens or in the payment provider's portal. A subscription ended mid-term by any other means SHALL end the term early, with the remaining payments recorded as owed. The site SHALL know at any time how many payments have been made and how many remain.

#### Scenario: cancelling halfway

- **WHEN** a member two payments into a 6-month monthly term tries to cancel
- **THEN** the cancellation is refused and says when the term ends, and the remaining payments stay due

Verified by: `packages/kit/build/fixed-terms-db.test.mts` and the billing view in a browser on Stripe test mode

### Requirement: What follows a term is the site's choice

Each term SHALL say what follows it: it ends (the default), it continues as the open-ended monthly membership until cancelled, or it renews for another term of the same length. Where a term ends, the member SHALL be reminded before it does. Where a term paid in full continues, the payment method SHALL be saved at checkout, with the buyer told so, and the continuation SHALL start when the term ends.

#### Scenario: a 6-month term that continues monthly

- **WHEN** the sixth payment of a 6-month monthly term marked to continue monthly is made
- **THEN** the next month is charged at the open-ended monthly price, and the member may cancel from then on

Verified by: `packages/kit/build/fixed-terms-db.test.mts`

### Requirement: Plan changes follow the site's policy

A membership SHALL say when a member on one of its terms may move to a higher tier and when to a lower one: any time, only at the end of the term, or never. Each direction SHALL be set separately. Without a setting, both SHALL be allowed any time, as today. A change the policy defers SHALL take effect when the term ends. A change it forbids SHALL be refused, with the reason.

#### Scenario: downgrades only at the end of the term

- **WHEN** a membership allows upgrades any time and downgrades at the end of the term, and a member three months into a 6-month term asks for a lower tier
- **THEN** the lower tier is scheduled for the end of the term, and an upgrade asked for at the same point takes effect at once

Verified by: `packages/kit/build/fixed-terms-db.test.mts`

### Requirement: A missed payment restricts access at once and is announced

When a payment of a monthly term fails, the member's access to the tier SHALL stop at once. An email SHALL go to the member, to their coach or provider, and to the site's administrators. When the payment is then made, access SHALL return at once, for the rest of the term. Each email SHALL take its words from the site's strings.

#### Scenario: a card declined, then fixed

- **WHEN** a monthly payment fails, and the member updates their card and pays four hours later
- **THEN** access stopped at the failure, the three emails were sent, and access returned when the payment was made

Verified by: `packages/kit/build/fixed-terms-db.test.mts` and the flow on Stripe test mode and the local Hyperswitch

### Requirement: Unpaid for 24 hours, a member's upcoming bookings are cancelled without refund

If a failed payment of a monthly term is still unpaid 24 hours after it failed, every upcoming booking of that member's SHALL be cancelled. This SHALL go through the site's ordinary cancellation, whichever scheduler holds the booking, the site's own or an external one. The cancellation SHALL be recorded with its reason, SHALL issue no refund, and SHALL be announced to the member and to each booking's host. Bookings cancelled this way SHALL stay cancelled when the payment is later made.

#### Scenario: still unpaid the next day

- **WHEN** a member with one booking in the site's own scheduler and one in an external scheduler leaves a failed payment unpaid for 24 hours
- **THEN** both bookings are cancelled with the reason recorded, no refund is issued, and paying afterwards restores access but not the bookings

Verified by: `packages/kit/build/fixed-terms-db.test.mts`, with the native and cal.com schedulers

### Requirement: An unpaid balance is recorded when retries end

When the payment provider stops retrying a failed payment, the term SHALL be marked in default, the amount still owed SHALL be recorded and shown to the member and to administrators, and administrators SHALL be told. Access SHALL stay off until the balance is paid.

#### Scenario: retries exhausted

- **WHEN** the provider's last retry of a monthly payment fails
- **THEN** the term is in default, the owed amount is the remaining payments of the term, and an administrator is emailed

Verified by: `packages/kit/build/fixed-terms-db.test.mts`

### Requirement: Terms work on every payment provider that runs subscriptions

Terms SHALL behave the same on the Stripe and Hyperswitch payment providers. The site SHALL NOT need provider-specific settings to sell them, beyond switching on payment methods in the provider's own dashboard. A term SHALL take its payments' outcomes from the reports each provider already gives the site, and SHALL NOT charge anything itself.

#### Scenario: the same term on both providers

- **WHEN** the same 3-month monthly term is bought, paid, missed and paid again on Stripe test mode and on the local Hyperswitch
- **THEN** the member's access, the emails, the payments counted and the end of the term are the same on both

Verified by: the flow on Stripe test mode and on the local Hyperswitch, recorded in the change's verification
