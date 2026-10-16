# Tasks

## 1. Combine the reader experience

- [x] 1.1 Refactor the existing Usage page into an embedded panel without dropping balances, history, packs, incremental-payment recovery, payment-method management, automatic top-up, or payout setup.
- [x] 1.2 Render the Usage panel in Billing's existing themed layout; remove the standalone Usage page route and duplicate account-settings navigation.
- [x] 1.3 Separate membership authentication/read failures from update failures, add load-specific editable copy, and preserve the successful no-membership state.
- [x] 1.4 Keep the Usage panel available to signed-in readers with no membership or a membership-read error, and show one combined sign-in prompt when signed out.

## 2. Preserve routes and references

- [x] 2.1 Redirect `/app/usage` to `/billing#usage` for direct loads, internal links, and history navigation while preserving all query parameters and the `/app/billing` alias.
- [x] 2.2 Consolidate account and mobile navigation, update editable Billing/Usage strings, and change PlatformKit-owned links to `/billing#usage`.
- [x] 2.3 Update PlatformKit documentation and the earlier usage-route spec/task references so they describe the combined destination and legacy redirect.
- [x] 2.4 Add a Docker Compose Hyperswitch v2 integration stack, a configurable loopback test runner, and opt-in test-suite wiring; keep credentials out of the repository.

## 3. Verify the combined page

- [x] 3.1 Verify signed-out, loading, membership-load-error, no-membership, active-membership, update-failure, and usage-error/data states with focused browser probes.
- [x] 3.2 Verify legacy redirect query preservation for payout and payment-method returns, then run focused usage/payment tests and the documentation check.
- [x] 3.3 Inspect the combined Billing and Usage page at mobile, tablet, and desktop widths in light and dark themes.
- [x] 3.4 Verify the Docker-backed Hyperswitch v2 stack starts and the opt-in integration runner can target its loopback port; do not run it in the default test suite.

## 4. Refine Billing tabs and membership reads

- [x] 4.1 Present Membership and Usage with the app's existing underlined desktop tabs and narrow-screen dropdown, default to Membership, and omit redundant navigation when Usage is unavailable.
- [x] 4.2 Show the Usage tab only to signed-in readers with a published usage offer or existing usage balances, activity, or settings; preserve access for readers without memberships and keep a retryable tab when relevance cannot be determined due to a read failure.
- [x] 4.3 Make `/billing#usage` and the `/app/usage` compatibility redirect select the Usage tab when relevant, including history navigation and provider-return query preservation.
- [x] 4.4 Read persisted memberships independently of payment-portal configuration, distinguish a true no-membership result from read failure, and use the configured provider's management flow.
- [x] 4.5 Probe tab visibility, deep links, no/active membership, provider-backed membership reads, and read/update errors; run focused tests and the docs check.
