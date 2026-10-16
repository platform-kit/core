# Spec Delta

## Purpose

Gives readers one account destination for membership and cross-operation usage self-service, while preserving existing payment and payout return flows.

## ADDED Requirements

### Requirement: Billing provides separate membership and usage views
At `/billing`, the platform SHALL provide separate Membership and Usage tabs, with Membership selected by default.

#### Scenario: A signed-in reader opens the Membership tab
- **WHEN** a signed-in reader opens `/billing`
- **THEN** the page selects the Membership tab and shows membership controls without rendering the Usage panel inline
- **Verified by** focused Billing browser probes

### Requirement: Usage availability follows reader relevance
The platform SHALL show Usage only to signed-in readers when the site publishes a usage product or the reader has usage balances, activity, or settings. Membership status SHALL NOT determine eligibility. If a usage read fails before relevance is known, keep Usage available for the retryable error. When usage is irrelevant, show Membership without a one-item selector.

#### Scenario: Usage is relevant to a signed-in reader
- **WHEN** the reader has a usage balance, activity, or settings, or the site has a published usage product
- **THEN** the Usage tab is available and selecting it shows the reader's usage controls
- **Verified by** the focused Billing and Usage browser probe

#### Scenario: A reader can use Usage without a membership
- **WHEN** the reader is signed in, has no active membership, and usage is relevant
- **THEN** the Usage tab remains available and the Membership tab clearly identifies that no active membership was found, with an action to browse plans
- **Verified by** the focused Billing and Usage browser probe

#### Scenario: Usage is not relevant to a signed-in reader
- **WHEN** the reader has no usage balances, activity, or settings and the site has no published usage product
- **THEN** the Usage tab is not displayed and the Membership view has no redundant one-item tab selector
- **Verified by** the focused Billing and Usage browser probe

#### Scenario: Usage relevance cannot be determined because a read failed
- **WHEN** the signed-in reader's usage data cannot be loaded and the site has no published usage product
- **THEN** the Usage tab remains available and displays the usage load error with a retry action
- **Verified by** the focused Billing and Usage browser probe

#### Scenario: A signed-out visitor reaches the combined page
- **WHEN** a signed-out visitor opens `/billing`
- **THEN** one sign-in prompt is shown, no Usage tab is displayed, and no private usage data is shown
- **Verified by** the focused Billing and Usage browser probe

### Requirement: Billing navigation follows the established responsive pattern
When both views are available, Billing SHALL use the app's established dropdown navigation on narrow screens.

#### Scenario: A signed-in reader opens Billing on a narrow screen
- **WHEN** the reader has relevant usage and opens `/billing` on a narrow screen
- **THEN** the dropdown navigation selects Membership by default and can switch to Usage
- **Verified by** focused Billing browser probes

### Requirement: Usage controls remain available in the combined view
The Usage view SHALL retain balances, cross-operation history, eligible pack purchases, incremental-payment recovery, saved-payment-method management, automatic top-up controls, and payout setup.

#### Scenario: A reader selects the Usage view
- **WHEN** a signed-in reader selects the Usage tab
- **THEN** the combined page shows the existing balances, history, eligible purchases, recovery, saved-method, top-up, and payout controls
- **Verified by** focused Billing and Usage browser probes

### Requirement: Membership and usage states describe the operation that failed

The platform SHALL distinguish a membership read failure from a membership update failure and from a successful read with no subscription. A membership read failure, including an authentication-session read failure, SHALL show a retryable load error. A failed membership update SHALL show update-specific error copy without implying that a membership read failed. Usage read failures SHALL remain separate from membership errors.

#### Scenario: Membership details cannot be loaded
- **WHEN** authentication or the membership read fails
- **THEN** the page shows a retryable membership-load message, not the membership-update message
- **Verified by** the focused Billing and Usage browser probe

#### Scenario: A valid membership exists for a configured payment provider
- **WHEN** a signed-in reader has an active membership record, including a Stripe-backed membership
- **THEN** the Membership tab shows its plan and status even if payment-portal configuration is unavailable
- **Verified by** focused provider and Billing tests

#### Scenario: No active membership exists
- **WHEN** the membership read succeeds and returns no active subscription
- **THEN** the page identifies that no active membership was found and offers a clear path to browse plans instead of showing a retryable read error
- **Verified by** the focused Billing and Usage browser probe

#### Scenario: A membership update fails
- **WHEN** a signed-in reader's membership update is rejected
- **THEN** the page shows an update-specific error while preserving the current membership details
- **Verified by** the focused Billing and Usage browser probe

#### Scenario: Usage cannot be loaded while membership is available

- **WHEN** the membership read succeeds but the usage read fails
- **THEN** the membership state remains available and the usage section shows its own retryable error
- **Verified by** the focused Billing and Usage browser probe

### Requirement: The former Usage address remains a compatible route
The platform SHALL redirect `/app/usage` to `/billing#usage` rather than render a separate Usage page. The redirect SHALL preserve the original query parameters and SHALL work for direct visits, browser history navigation, and internal links.

#### Scenario: A reader opens the former Usage address
- **WHEN** a reader opens `/app/usage`
- **THEN** the browser displays `/billing#usage` and selects the Usage tab when that tab is relevant to the signed-in reader
- **Verified by** the focused route and browser probe

#### Scenario: A payment or payout return uses the former Usage address

- **WHEN** a provider returns to `/app/usage` with payment-method or payout-setup query parameters
- **THEN** the browser displays `/billing#usage` with every original query parameter intact so the existing return flow can complete
- **Verified by** the focused route and browser probe

#### Scenario: A reader follows an old internal Usage link
- **WHEN** a reader follows an internal link to `/app/usage`
- **THEN** it opens the Usage tab when that tab is relevant, without rendering a separate Usage surface
- **Verified by** the focused route and browser probe

#### Scenario: A Usage deep link is not relevant to the reader
- **WHEN** a signed-in reader opens `/billing#usage` but has no usage data or settings and the site has no published usage product
- **THEN** the Membership tab remains selected and the unavailable Usage tab is not displayed
- **Verified by** the focused route and browser probe
