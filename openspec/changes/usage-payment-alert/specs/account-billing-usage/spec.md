## ADDED Requirements

### Requirement: A usage payment needing the customer is announced on every page

When a signed-in customer has an incremental usage payment that needs them — verification is required, or the payment failed — the site SHALL show a red alert banner at the top of every page, built from the same strip as the page builder's Announcement section. The banner SHALL say which of the two it is and link to the Usage view, where the recovery controls are. Dismissing it SHALL hide it for the current page view only; it SHALL return on the next page load or navigation until no such payment remains. A payment that is only processing SHALL NOT raise the banner. The banner SHALL NOT appear on the checkout pages, on an embed shown inside another site, or on preview and share renders. Which payments need the customer SHALL be answered by the server for the signed-in customer alone; the browser SHALL NOT read the settlement records directly.

#### Scenario: a payment needs verification

- **WHEN** a signed-in customer has a usage payment whose verification is required
- **THEN** every page shows the red banner with the verification line and a link to the Usage view

Verified by: `node build/usage-alert.test.mjs` (the status-to-banner rule), and the rendered banner on a landing page, a content page and Billing at 1280×900 and 390×844 in light and dark

#### Scenario: a payment failed

- **WHEN** a signed-in customer has a usage payment that failed
- **THEN** every page shows the red banner with the failed-payment line

Verified by: `node build/usage-alert.test.mjs`

#### Scenario: a processing payment, or none

- **WHEN** a customer's only usage payment is processing, or they have none, or they are signed out
- **THEN** no banner appears

Verified by: `node build/usage-alert.test.mjs`, and a rendered page for a signed-out visitor

#### Scenario: dismissal lasts one page view

- **WHEN** the customer dismisses the banner and then navigates to another page
- **THEN** the banner is hidden on the page where it was dismissed and shown again on the next page

Verified by: the rendered banner dismissed, then a navigation, in a real browser

#### Scenario: pages the banner stays off

- **WHEN** the customer is on a checkout page, an embed, or a preview or share render
- **THEN** the banner does not appear

Verified by: `node build/usage-alert.test.mjs` (the path rule)

#### Scenario: the server answers for the signed-in customer only

- **WHEN** the browser asks whether a usage payment needs attention
- **THEN** the usage function answers from the signed-in customer's own subscriptions, returning only whether verification is required or a payment failed, and an unauthenticated request is refused

Verified by: the usage function's attention read against the local stack with a seeded settlement, and an unauthenticated request
