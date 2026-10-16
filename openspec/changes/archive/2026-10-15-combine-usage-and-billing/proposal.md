# Proposal

## Why

Membership management and usage controls currently live on separate account pages, with separate navigation. Bringing them together gives readers one clear place to review their membership, balances, activity, payment methods, and usage settings. The membership page also uses the same error copy for failed reads and failed updates, which can tell readers the wrong thing.

## What Changes

- Make `/billing` the single self-service destination, with membership and usage in separate tabs using the app's established responsive tab navigation. Show Usage only when relevant, and omit redundant navigation when Membership is the only available section.
- Redirect `/app/usage` to `/billing#usage`, retaining payout and payment-method return parameters.
- Remove the standalone Usage navigation entry and update PlatformKit-owned links and documentation.
- Distinguish membership loading failures from failed membership updates; read existing memberships independently of payment-portal configuration, preserve the genuine no-membership state, and keep relevant usage available without a membership.
- Add an opt-in Docker-backed Hyperswitch v2 integration stack and test entry point without slowing the default unit-test suite.

### Billing page introduction

Purpose: identify the combined destination and explain what readers can manage there.

- Heading: **“Billing and usage”**
- Introduction: **“Manage your membership and review your usage, payment methods, and activity.”**

### Membership states

Purpose: make authentication and failed reads actionable without conflating them with a failed update.

- Signed out: **“Sign in to manage your membership and view your usage.”**
- Membership load failure: **“Your membership details could not be loaded. Try again.”**
- Membership update failure: **“Your membership settings could not be updated. Try again.”**
- No active membership: **“You do not have an active membership to manage.”**

### Usage tab

Purpose: keep balances, activity, packs, incremental-payment recovery, saved-payment-method controls, automatic top-up, and payout setup in a focused tab within Billing. Show it only when usage is relevant to the signed-in reader.

- Heading: **“Your usage”**
- Loading: **“Loading your usage…”**
- Load failure: **“Your usage could not be loaded. Try again.”**

## Capabilities

### New Capabilities

- `account-billing-usage`: the tabbed membership and usage self-service destination, including conditional Usage availability, provider-backed membership states, and the legacy Usage URL behavior.

### Modified Capabilities

None. Existing main specifications do not currently define this account surface.

## Impact

The default theme's Billing and Usage pages, application router, account menus, editable UI strings, the membership portal function, PlatformKit documentation, and opt-in payment-provider test tooling are affected. The change reads existing subscription records and uses the configured provider's management flow; it does not change subscription or usage data contracts.
