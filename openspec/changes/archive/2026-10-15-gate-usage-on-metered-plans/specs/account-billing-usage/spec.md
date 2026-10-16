# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Usage availability follows reader relevance`
- TO: `### Requirement: Usage visibility follows published metered plans`

## MODIFIED Requirements

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
