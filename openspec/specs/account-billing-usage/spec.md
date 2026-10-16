# account-billing-usage Specification

## Purpose

Gives readers one account destination for membership and cross-operation usage self-service, while preserving existing payment and payout return flows.

## Requirements

### Requirement: Billing provides separate membership and usage views

At `/billing`, the platform SHALL use “Billing” as its main heading and SHALL NOT display an Account eyebrow or descriptive intro. It SHALL provide a Membership view and show a separate Usage tab only when the site publishes at least one subscription offer with a non-empty metered usage definition. Membership SHALL be selected by default. When no qualifying offer is published, the Membership view SHALL appear without a redundant one-item selector. Signed-out visitors SHALL see one sign-in prompt without Usage tabs or private Usage data.

#### Scenario: A signed-in reader opens the Membership tab

- **WHEN** a signed-in reader opens `/billing`
- **THEN** the page is headed “Billing” without an Account eyebrow or descriptive intro, selects the Membership tab, and shows membership controls without rendering the Usage panel inline

#### Scenario: A signed-out visitor reaches Billing

- **WHEN** a signed-out visitor opens `/billing` on a site with a published metered subscription plan
- **THEN** the sign-in prompt is shown without Usage tabs or private Usage data

### Requirement: Usage visibility follows published metered plans

At `/billing`, the platform SHALL make Usage available to signed-in readers only when the site publishes at least one subscription offer with a non-empty metered usage definition. A prepaid pack alone SHALL NOT qualify. Reader membership, historical usage, balances, top-up settings, or Usage read failures SHALL NOT make Usage available when the site has no published metered plan. When a metered plan is published, Usage SHALL be available to every signed-in reader, including readers with no membership or usage data. The site-level gate SHALL be applied before rendering the Usage panel or issuing private Usage data reads.

#### Scenario: Usage is relevant to a signed-in reader

- **WHEN** the site publishes a subscription offer with a metered usage plan and a signed-in reader opens `/billing`
- **THEN** the page offers Membership and Usage tabs, with Membership selected by default; the reader can select Usage whether or not they have membership or usage history

#### Scenario: A reader can use Usage without a membership

- **WHEN** the reader is signed in, has no active membership, and the site publishes a subscription offer with a metered usage plan
- **THEN** the Usage tab remains available and the Membership tab clearly identifies that no active membership was found, with an action to browse plans

#### Scenario: Usage is not relevant to a signed-in reader

- **WHEN** the site has no published metered subscription plan, even if the reader has balances, activity, history, or settings and the site sells prepaid usage packs
- **THEN** a signed-in reader sees the Membership view without a Usage tab or one-item selector, even if the reader has historical usage, balances, or top-up settings

#### Scenario: An unpublished metered plan does not enable Usage

- **WHEN** the site has metered subscription offers but none are published
- **THEN** a signed-in reader sees the Membership view without a Usage tab

#### Scenario: Usage relevance cannot be determined because a read failed

- **WHEN** a signed-in reader visits a site with a published metered subscription plan and the Usage read fails
- **THEN** the Usage tab remains available and its panel shows the retryable Usage error without replacing Membership state

### Requirement: Billing navigation follows the established responsive pattern

When both views are available, Billing SHALL use the app's established dropdown navigation on narrow screens.

#### Scenario: A signed-in reader opens Billing on a narrow screen

- **WHEN** a signed-in reader opens Billing on a narrow screen at a site with a published metered subscription plan
- **THEN** the dropdown navigation selects Membership by default and can switch to Usage

### Requirement: Usage controls remain available in the combined view

The Usage view SHALL retain balances, cross-operation history, eligible pack purchases, incremental-payment recovery, saved-payment-method management, automatic top-up controls, and payout setup.

#### Scenario: A reader selects the Usage view

- **WHEN** a signed-in reader selects the Usage tab
- **THEN** the combined page shows the existing balances, history, eligible purchases, recovery, saved-method, top-up, and payout controls

### Requirement: Membership and usage states describe the operation that failed

The platform SHALL distinguish a membership read failure from a membership update failure and from a successful read with no subscription. A membership read failure, including an authentication-session read failure, SHALL show a retryable load error. A failed membership update SHALL show update-specific error copy without implying that a membership read failed. Usage read failures SHALL remain separate from membership errors.

#### Scenario: Membership details cannot be loaded

- **WHEN** authentication or the membership read fails
- **THEN** the page shows a retryable membership-load message, not the membership-update message

#### Scenario: A valid membership exists for a configured payment provider

- **WHEN** a signed-in reader has an active membership record, including a Stripe-backed membership
- **THEN** the Membership tab shows its plan and status even if payment-portal configuration is unavailable

#### Scenario: No active membership exists

- **WHEN** the membership read succeeds and returns no active subscription
- **THEN** the page identifies that no active membership was found and offers a clear path to browse plans instead of showing a retryable read error

#### Scenario: A membership update fails

- **WHEN** a signed-in reader's membership update is rejected
- **THEN** the page shows an update-specific error while preserving the current membership details

#### Scenario: Usage cannot be loaded while membership is available

- **WHEN** the membership read succeeds but the usage read fails
- **THEN** the membership state remains available and the usage section shows its own retryable error

### Requirement: The former Usage address remains a compatible route

The platform SHALL redirect `/app/usage` to `/billing#usage` rather than render a separate Usage page. The redirect SHALL preserve the original query parameters and SHALL work for direct visits, browser history navigation, and internal links.

#### Scenario: A reader opens the former Usage address

- **WHEN** a signed-in reader opens `/app/usage` on a site with a published metered subscription plan
- **THEN** the browser displays `/billing#usage` and selects the Usage tab

#### Scenario: A payment or payout return uses the former Usage address

- **WHEN** a provider returns to `/app/usage` with payment-method or payout-setup query parameters
- **THEN** the browser displays `/billing#usage` with every original query parameter intact so the existing return flow can complete

#### Scenario: A reader follows an old internal Usage link

- **WHEN** a signed-in reader follows an internal link to `/app/usage` on a site with a published metered subscription plan
- **THEN** it opens the Usage tab without rendering a separate Usage surface

#### Scenario: A Usage deep link is not relevant to the reader

- **WHEN** a signed-in reader opens `/billing#usage` or is redirected from `/app/usage` on a site without a published metered subscription plan, even if the reader has usage data or settings
- **THEN** the Membership view remains selected, no Usage tab or panel is displayed, and legacy route query parameters remain preserved

### Requirement: Usage offers default to credits when no unit is configured

A usage offer with an omitted or blank unit SHALL resolve to “credits” during catalog compilation. A site SHALL be allowed to publish a metered offer without specifying a unit; its declared usage rate SHALL apply per credit. The Usage view SHALL label balances and activity with the offer's resolved non-empty unit when available. For historical activity whose offer has no unit, the view SHALL use the event's non-empty recorded unit, or “credits” if neither provides a unit. Explicit units SHALL remain unchanged, and the default SHALL NOT convert numeric usage quantities.

#### Scenario: A configured offer unit is displayed

- **WHEN** a balance or activity record is shown for an offer with a configured unit
- **THEN** the Usage view labels the quantity with that offer unit, even if an activity record has a different recorded unit
- **Verified by:** `node --test packages/kit/build/usage-unit.test.mjs`

#### Scenario: A usage offer without a unit defaults to credits

- **WHEN** a site compiles a usage offer with its unit omitted or blank
- **THEN** the resulting offer uses “credits”, and a metered offer is not rejected solely because its unit was omitted
- **Verified by:** `cd sites/demo && node --test ../../packages/kit/build/usage.test.mjs` and `cd sites/demo && node ../../packages/kit/build/deploy-checks.mjs --test`

#### Scenario: A recorded activity unit is used for legacy activity

- **WHEN** an activity record has a non-empty recorded unit but its historical offer has no unit
- **THEN** the Usage view labels the quantity with the recorded unit
- **Verified by:** `node --test packages/kit/build/usage-unit.test.mjs`

#### Scenario: Credits label activity with no available unit

- **WHEN** an activity record has neither an offer unit nor a non-empty recorded unit
- **THEN** the Usage view labels the unchanged quantity in “credits”
- **Verified by:** `node --test packages/kit/build/usage-unit.test.mjs`
