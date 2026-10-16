# Tasks

## 1. Catalog eligibility and Billing behavior

- [x] 1.1 Define and test the qualifying offer rule: published subscription offer with a non-empty metered usage definition; verify published metered, unpublished metered, prepaid-only, and non-usage offers with `node --test packages/kit/build/usage-eligibility.test.mjs`.
- [x] 1.2 Gate the Billing Usage tab, panel, and Usage reads on that site-level rule; verify browser scenarios for no metered plan despite reader history/settings, a metered plan with an empty reader account, usage-read failure with a metered plan, and `/billing#usage` plus `/app/usage` query preservation when no metered plan exists.
- [x] 1.3 Use “Billing” as the page and navigation label; remove the Account eyebrow and explanatory intro, and keep sign-in copy route-specific.

## 2. Documentation and verification

- [x] 2.1 Update the Usage billing guide and account guide to explain the metered-plan gate and call the destination Billing; verify with `node packages/kit/build/docs-check.mjs`.
- [x] 2.2 Verify every scenario in `specs/account-billing-usage/spec.md`, including signed-out behavior, the concise Billing heading, no eyebrow/intro, and desktop/390px views; run the focused eligibility test and demo build, and report each scenario as passed, failed, or not verified.
