# Tasks

## 1. The journeys runner

- [ ] 1.1 Add `build/stripe-journeys.integration.mjs` and its Deno/browser steps: refuse non-test keys before any request; deliver Stripe's genuine events to the local webhook through `stripe listen` when installed, else from Stripe's events API signed with the local endpoint secret; clean up everything it creates. Verified by running it with a test key, and with a live-shaped key refused.
- [ ] 1.2 Purchase journeys: signed-in and guest one-off purchases with files, downloads, and the guest's order found after sign-up. Verified by the runner.
- [ ] 1.3 Subscription journeys with test clocks: trial, upgrade now, downgrade at renewal, cancel at period end and resume, failed renewal to "needs attention" and access ending. Verified by the runner, reading the Billing page and the reader's access at each step.
- [ ] 1.4 Refund removing a book unlock, and each event delivered twice leaving the ledger, grants and sent emails unchanged. Verified by the runner.
- [ ] 1.5 The usage page's verification step in headless Chromium with Stripe.js and the test publishable key. Verified by the runner; reported as not run without the key.

## 2. Reconciliation

- [ ] 2.1 Add an optional `listRecords` capability to the provider contract and implement it for Stripe (recent payments, refunds and subscriptions). Verified by `node build/payment-provider-adapters.test.mjs` and the Stripe test-mode runner.
- [ ] 2.2 Add the `payment_differences` record, the `payments-reconcile` function and its nightly job in the `store` module, writing only differences. Verified by `node build/reconcile-db.test.mjs` with a stub provider: the five kinds, a second run, and agreement.
- [ ] 2.3 List open differences on the Payments screen, or "agree as of", or "not checked" for a provider without `listRecords`, with copy in the theme's payments strings. Verified by the rendered screen at 1280×900 and 390×844 in light and dark, and `node build/strings.test.mjs`.
- [ ] 2.4 End the journeys runner with a reconciliation over its own records, expecting no difference. Verified by the runner.

## 3. Documentation

- [ ] 3.1 Document the journeys runner and reconciliation on `sites/docs/content/docs/building-a-site/payment-providers.md`, the Payments screen on the payments running-a-site page, and add both to FEATURES.md. Verified by `node build/docs-check.mjs`.

## 4. Verify

- [ ] 4.1 Run the journeys runner against Stripe test mode, `node build/reconcile-db.test.mjs`, the adapter contract test, `openspec validate verify-payment-journeys --strict` and the docs check, and inspect the Payments screen states. Report each scenario as passed, failed, or not verified, with the reason.
