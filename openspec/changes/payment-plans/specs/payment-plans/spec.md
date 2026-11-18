## ADDED Requirements

### Requirement: Any offer may be sold on a payment plan

An offer sold for one price SHALL be able to list payment plans, each a number of monthly payments at a price the site writes, never derived from the full price. The buyer SHALL be able to pay in full or choose a plan. A plan SHALL grant what the offer grants from its first payment. The build SHALL refuse a plan with fewer than two payments, a plan without a positive price, a plan on a subscription or on an offer that ships, and a plan on a site whose payment provider can't run subscriptions. An offer with no plans SHALL behave exactly as before.

#### Scenario: a course in three payments

- **WHEN** a course priced at 4500 lists a plan of three payments of 1600, and a buyer chooses the plan
- **THEN** they are charged 1600 now and on each of the next two months, they hold the course from the first payment, and the charges stop after the third

Verified by: `packages/kit/build/catalog.test.mts` and `packages/kit/build/payment-plans-db.test.mts`

#### Scenario: an existing offer is untouched

- **WHEN** an offer with no plans or terms is built, bought, renewed and cancelled
- **THEN** every step behaves and is priced exactly as before this change

Verified by: the existing catalogue, checkout and membership tests, unchanged

### Requirement: A membership may be sold in fixed terms

A membership product SHALL be able to list any number of terms, each a whole number of months with its own prices: a price to pay in full, a monthly price, or both, all the site's own. A membership MAY offer terms alongside its open-ended price, or terms alone. A term SHALL grant the membership's tier for its length. The build SHALL refuse a term with no price, two terms of the same length, a length that isn't a whole number of months, terms on anything but a membership, and a membership with neither a price nor terms.

#### Scenario: three terms in one product file

- **WHEN** a membership lists a 3-month term with both prices, a 6-month term with both, and a 12-month term with a full price only
- **THEN** the catalogue offers five ways to buy it, each at the price written in the file, and the 12-month term has no monthly option

Verified by: `packages/kit/build/catalog.test.mts`

#### Scenario: a 3-month term paid in full

- **WHEN** a buyer pays a 3-month term in full
- **THEN** they hold the tier from that day until three months later, and lose it then unless the term continues

Verified by: `packages/kit/build/payment-plans-db.test.mts`

### Requirement: The buyer accepts the commitment, and the server sets the price

Before paying for a plan or term, the buyer SHALL see and accept the commitment: the number and amount of the payments, that it can't be cancelled before its last payment, what a missed payment does, and, for a term, what follows it. The server SHALL set the price from the catalogue, whatever the request says. Paying in full SHALL accept every one-off payment method the payment provider offers the site, Klarna and Affirm included where they are switched on.

#### Scenario: a tampered price

- **WHEN** a checkout request names a 6-month monthly term but carries a lower amount
- **THEN** the buyer is charged the catalogue's monthly price for that term

Verified by: `packages/kit/build/checkout-tamper.test.mts`

### Requirement: A commitment can't be cancelled before its last payment

A plan or monthly term SHALL charge through the site's subscriptions until its number of payments is made. The buyer SHALL NOT be able to cancel it before then, or change plan except as the membership's change policy allows, in the site's own screens or in the payment provider's portal. A subscription ended mid-commitment by any other means SHALL end the commitment early, with the remaining payments recorded as owed. The site SHALL know at any time how many payments have been made and how many remain.

#### Scenario: cancelling halfway

- **WHEN** a member two payments into a 6-month monthly term tries to cancel
- **THEN** the cancellation is refused and says when the term ends, and the remaining payments stay due

Verified by: `packages/kit/build/payment-plans-db.test.mts` and the billing view in a browser on Stripe test mode

### Requirement: What follows a term is the site's choice

Each term SHALL say what follows it: it ends (the default), it continues as the open-ended monthly membership until cancelled, or it renews for another term of the same length. Where a term ends, the member SHALL be reminded before it does. Where a term paid in full continues, the payment method SHALL be saved at checkout, with the buyer told so, and the continuation SHALL start when the term ends.

#### Scenario: a 6-month term that continues monthly

- **WHEN** the sixth payment of a 6-month monthly term marked to continue monthly is made
- **THEN** the next month is charged at the open-ended monthly price, and the member may cancel from then on

Verified by: `packages/kit/build/payment-plans-db.test.mts`

#### Scenario: a 3-month term paid in full that continues

- **WHEN** a term paid in full and marked to continue monthly or to renew closes, and the card it was paid with was kept
- **THEN** the monthly membership begins on that card, or the full price is charged and a new term starts the day the first ends; a declined card starts nothing and the term ends, the member told

Verified by: `packages/kit/build/payment-plans-continue.test.mts`

#### Scenario: renewal turned off

- **WHEN** a member turns renewal off on the Billing page before a term ends
- **THEN** the term's own payments are still owed, and nothing follows it

Verified by: `packages/kit/build/payment-plans-continue.test.mts`

### Requirement: Plan changes follow the site's policy

A membership SHALL say when a member on one of its terms may move to a higher tier and when to a lower one: any time, only at the end of the term, or never. Each direction SHALL be set separately. Without a setting, both SHALL be allowed any time, as today. A change the policy defers SHALL take effect when the term ends. A change it forbids SHALL be refused, with the reason.

#### Scenario: downgrades only at the end of the term

- **WHEN** a membership allows upgrades any time and downgrades at the end of the term, and a member three months into a 6-month term asks for a lower tier
- **THEN** the lower tier is scheduled for the end of the term, and an upgrade asked for at the same point takes effect at once

Verified by: `packages/kit/build/payment-plans-db.test.mts`

### Requirement: What a missed payment does is the site's choice

Each offer with plans or terms SHALL say when a missed payment stops access: at once (the default), only when the provider stops retrying, or never. When access is stopped and the payment is then made, access SHALL return at once. A missed payment SHALL be emailed to the buyer and the site's administrators, and, where the site has sessions, to each host of the buyer's upcoming bookings, each email taking its words from the site's strings.

#### Scenario: a card declined, then fixed

- **WHEN** an offer stops access at once, a monthly payment fails, and the buyer updates their card and pays four hours later
- **THEN** access stopped at the failure, the emails were sent, and access returned when the payment was made

Verified by: `packages/kit/build/payment-plans-db.test.mts` and the flow on Stripe test mode and the local Hyperswitch

#### Scenario: access kept until retries end

- **WHEN** an offer stops access only when retries end, and a monthly payment fails
- **THEN** the buyer keeps access, and the emails are sent

Verified by: `packages/kit/build/payment-plans-db.test.mts`

### Requirement: A site with sessions may cancel bookings after a grace period

An offer SHALL be able to name a grace period after which a missed payment cancels the buyer's upcoming bookings. Without one, no booking SHALL be cancelled. The rule SHALL belong to the sessions module, and the build SHALL refuse a grace period on a site with sessions off. The cancellation SHALL go through the site's ordinary cancellation, whichever scheduler holds the booking, SHALL be recorded with its reason, SHALL issue no refund, and SHALL be announced to the buyer and to each booking's host. Bookings cancelled this way SHALL stay cancelled when the payment is later made.

#### Scenario: still unpaid the next day

- **WHEN** an offer's grace period is 24 hours, and a buyer with one booking in the site's own scheduler and one in an external scheduler leaves a failed payment unpaid for 24 hours
- **THEN** both bookings are cancelled with the reason recorded, no refund is issued, and paying afterwards restores access but not the bookings

Verified by: `packages/kit/build/payment-plans-db.test.mts`, with the native and cal.com schedulers

#### Scenario: no grace period named

- **WHEN** an offer names no grace period, and a payment stays unpaid for a week
- **THEN** no booking is cancelled

Verified by: `packages/kit/build/payment-plans-db.test.mts`

### Requirement: An unpaid balance is recorded when retries end

When the payment provider stops retrying a failed payment, the commitment SHALL be marked in default, the amount still owed SHALL be recorded and shown to the buyer and to administrators, and administrators SHALL be told. Access SHALL stay off until the balance is paid, unless the offer says a missed payment never stops access.

#### Scenario: retries exhausted

- **WHEN** the provider's last retry of a monthly payment fails
- **THEN** the commitment is in default, the owed amount is its remaining payments, and an administrator is emailed

Verified by: `packages/kit/build/payment-plans-db.test.mts`

### Requirement: Plans and terms work on every payment provider that runs subscriptions

Plans and terms SHALL behave the same on the Stripe and Hyperswitch payment providers. The site SHALL NOT need provider-specific settings to sell them, beyond switching on payment methods in the provider's own dashboard. A commitment SHALL take its payments' outcomes from the reports each provider already gives the site, and SHALL NOT charge anything itself.

#### Scenario: the same term on both providers

- **WHEN** the same 3-month monthly term is bought, paid, missed and paid again on Stripe test mode and on the local Hyperswitch
- **THEN** the buyer's access, the emails, the payments counted and the end of the term are the same on both

Verified by: the flow on Stripe test mode and on the local Hyperswitch, recorded in the change's verification
