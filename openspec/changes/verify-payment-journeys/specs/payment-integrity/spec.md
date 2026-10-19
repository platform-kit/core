## Purpose

Prove that money journeys work from payment to access, and keep the site's ledger in step with the payment provider's own records so a missed event is noticed.

## ADDED Requirements

### Requirement: Money journeys are proven from payment to access

PlatformKit SHALL ship an opt-in suite that runs each money journey against the payment provider's test mode and the local stack, and checks the outcome where a customer sees it: what they can read, download, book or join, and what the Billing page says. It SHALL refuse to run with anything other than test-mode keys, and SHALL refund, cancel or delete everything it creates.

#### Scenario: a purchase grants what it bought

- **WHEN** a signed-in buyer and a guest each buy a one-off product with downloadable files in test mode, and the provider's events reach the site
- **THEN** each has an order in the ledger, the signed-in buyer can download the files, and the guest can after signing up with the same email

Verified by: `node build/stripe-journeys.integration.mjs <private test env>` (purchase journeys)

#### Scenario: a subscription's life

- **WHEN** a reader starts a subscription with a free trial, upgrades, schedules a downgrade, cancels at period end and resumes, with the provider's clock advanced past each renewal
- **THEN** the Billing page and the reader's access match each state: trial, the upgraded tier at once, the lower tier from the renewal, still a member after cancelling until the period ends, and unchanged after resuming

Verified by: `node build/stripe-journeys.integration.mjs` (subscription journeys, using the provider's test clocks)

#### Scenario: a renewal fails

- **WHEN** a subscription's renewal is charged to a card that declines, and later the subscription ends unpaid
- **THEN** the membership shows "Payment needs attention" while the provider retries, and access ends when the subscription ends

Verified by: `node build/stripe-journeys.integration.mjs` (failed renewal)

#### Scenario: a refund

- **WHEN** a purchase that unlocked a book is refunded at the provider
- **THEN** the ledger records the refund and the book is no longer unlocked for the buyer

Verified by: `node build/stripe-journeys.integration.mjs` (refund)

#### Scenario: the same event twice

- **WHEN** each event of a purchase and a renewal is delivered to the site a second time
- **THEN** the ledger, the grants and the emails sent are exactly as after the first delivery

Verified by: `node build/stripe-journeys.integration.mjs` (duplicate delivery)

#### Scenario: the usage page's verification step

- **WHEN** an incremental usage charge needs card verification and the reader completes it on the usage page in a real browser
- **THEN** the charge is settled once, the payment banner disappears, and the usage page shows it confirmed

Verified by: `node build/stripe-journeys.integration.mjs` (usage verification in a browser; needs a test-mode publishable key)

#### Scenario: live keys are refused

- **WHEN** the suite is given a live secret or publishable key
- **THEN** it stops before sending any request

Verified by: `node build/stripe-journeys.integration.mjs` with a live-shaped key

### Requirement: The ledger is checked against the provider's records

A scheduled job SHALL compare the site's ledger with the selected provider's records of recent payments, refunds and subscriptions, at least daily, and SHALL record every difference: paid at the provider but missing on the site, refunded at the provider but still granted on the site, a different amount, a different status, and present on the site but not at the provider. Administrators SHALL see the differences on the Payments screen. The check SHALL change no payment, grant or record. A provider whose adapter cannot list its records SHALL be shown as not checked.

#### Scenario: differences are found and listed

- **WHEN** the ledger holds one purchase the provider doesn't know, misses one the provider has, still grants a purchase the provider refunded, and differs in one amount and one status
- **THEN** the job records exactly those five differences with their kinds, and the Payments screen lists them

Verified by: `node build/reconcile-db.test.mjs` against the local stack with a stub provider, and the rendered Payments screen at 1280×900 and 390×844 in light and dark

#### Scenario: running twice, and nothing changed

- **WHEN** the job runs twice over the same records
- **THEN** each difference is listed once, and no ledger, grant or subscription row is changed

Verified by: `node build/reconcile-db.test.mjs`

#### Scenario: everything agrees

- **WHEN** the ledger and the provider agree
- **THEN** the Payments screen says they agree as of the last check

Verified by: `node build/reconcile-db.test.mjs`, and the rendered Payments screen

#### Scenario: against real test-mode records

- **WHEN** the journeys suite has run
- **THEN** the reconciliation over its records reports no difference

Verified by: `node build/stripe-journeys.integration.mjs` (final step)
