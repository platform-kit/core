# Proposal

## Why

Usage visibility currently follows a mix of reader history, settings, and usage offers, so a membership account can see a Usage tab even when its site does not sell metered plans. Eligibility should follow the site's published offer catalog, not a reader's membership or historical records.

## What Changes

- Show the Usage tab only when the site has at least one published subscription offer with a metered usage definition.
- Do not show Usage on prepaid-pack-only sites or because a reader has historical usage, balances, or top-up settings without a published metered plan.
- Keep the Membership view selected for Usage deep links when the site has no published metered plan.
- Preserve the existing Usage empty states when a metered plan is available but the reader has no usage data.
- Name the page and its navigation entry “Billing”; omit the unrelated Account eyebrow and redundant page description.
- Keep any sign-in explanation editable and route-specific, without implying that every site offers metered Usage.
- No new reader-facing copy is proposed. “No usage yet” describes the empty balance/activity state; “No usage packs are available right now.” describes unavailable prepaid packs; “Automatic top-up is not enabled on this site.” describes disabled refills when the Usage view is available.

Non-goals: changing offer billing, provider integrations, usage records, or downstream site catalogs.

## Capabilities

### Modified Capabilities

- `account-billing-usage`: Restrict the Usage view to sites with a published metered subscription plan, regardless of individual reader history or settings.

## Impact

The Billing and Usage portal and its compatibility route in `packages/movable-types`, the Usage billing guide at `sites/docs/content/docs/running-a-site/selling/usage-billing.md`, and focused catalog-eligibility and browser verification.
