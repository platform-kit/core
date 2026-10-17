# Tasks

## 1. Provider contract and site configuration

- [x] 1.1 Publish the server-side provider contract, normalized event/outcome types, and declared capabilities as a supported site extension API; verify contract tests cover operations, normalization, and unsupported features.
- [x] 1.2 Extend the site module registration model so site-owned modules can register a complete adapter factory, provider identity, implementations for enabled payment operations, capabilities, webhook handling, and secret requirements without kit changes; verify a site fixture assembles a custom mock provider and its declared route/secrets.
- [x] 1.3 Add site-level selection of one registered provider with Stripe as the compatibility default; verify unknown provider ids and missing provider secrets fail configuration/deploy checks and secrets do not enter browser bundles.
- [x] 1.4 Add adapter selection and capability validation before provider side effects; verify unsupported cart and billing options fail before any provider request using provider contract tests.

## 2. Provider-scoped payment references

- [x] 2.1 Inventory Stripe identifiers and event-idempotency references across the declared schema and payment workflows, then add provider identity to persisted external references without changing order or entitlement ownership; verify schema declaration coverage and focused migration tests.
- [x] 2.2 Backfill existing customer, checkout, payment, subscription, price, usage, and event references as Stripe using a repeatable migration; verify populated-database migration tests preserve all records and produce no duplicates.
- [x] 2.3 Update provider lookup and reconciliation to require matching provider identity while retaining compatibility reads for existing Stripe rows; verify collisions across provider namespaces cannot cross-link records in `build/payment-provider-db.test.mjs`.

## 3. Stripe adapter and checkout operations

- [x] 3.1 Register the Stripe implementation through the same provider contract used by site-owned adapters, then move Stripe customer, checkout-session, subscription-change, portal, confirmation, and catalog operations behind it; preserve the current `content/store/products/*.md` → `catalog.json` → `push-catalog` Stripe flow and verify existing Stripe checkout, subscription, portal, and catalog tests retain their outcomes.
- [x] 3.2 Normalize provider checkout and subscription results at the adapter boundary while keeping the site's offer catalog authoritative; verify checkout, guest purchase, trial, tax, quantity, and payment-method regression tests.
- [x] 3.3 Route store, session booking, memberships, forms, and provider-offering purchase entry points through the provider-neutral checkout path, using provider-scoped commerce identities for idempotent reconciliation and fulfillment; verify each exposed purchase surface using targeted function and browser tests.

## 4. Webhook verification and commerce reconciliation

- [x] 4.1 Move Stripe raw-body signature verification and Stripe event decoding into its adapter while retaining the existing Stripe webhook route; verify valid signatures pass and malformed or invalid signatures make no writes.
- [x] 4.2 Normalize Stripe checkout, subscription, invoice, expiration, refund, and payment-failure events before applying the existing ledger and fulfillment rules; verify ledger tests preserve idempotency, fulfillment, grants, cancellations, and reversals.
- [x] 4.3 Namespace normalized webhook idempotency by provider and test duplicate and colliding event identifiers against `build/payment-provider-db.test.mjs`.

## 5. Usage billing and connected-account payouts

- [x] 5.1 Move Stripe usage-meter event submission, included-usage reconciliation, and automatic top-up payment operations behind declared provider capabilities; verify `build/usage.test.mjs` and `build/usage-db.test.mjs`.
- [x] 5.2 Route connected-account onboarding, readiness checks, and payouts through explicit provider operations while preserving Stripe Connect behavior and refusing unsupported adapters before payout-ledger claims; verify `build/payouts-db.test.mjs` and provider capability tests.
- [ ] 5.3 Implement optional Stripe incremental usage charges from the shared offer threshold; persist period-scoped settlement progress, avoid submitting already-charged usage to Stripe metering, collect the period-end remainder once, require `STRIPE_PUBLISHABLE_KEY` only for opted-in Stripe offers, and verify threshold, uncertain retry, new-attempt decline retry, and action-required recovery through the authenticated usage page. The deterministic settlement suite now passes threshold/remainder, ambiguous outcomes, pending reconciliation, decline retries with new idempotency identities, changed saved methods, and action-required settlement; the customer page's pending/failed/requires-action states and Hyperswitch Vault payment-method manager were rendered with an authenticated stub at desktop and mobile/light and dark. Real Stripe test mode (2026-10-16, `node build/stripe-usage-recovery.integration.mjs`): the adapter's off-session charge on an authentication-required card returns action required with a client secret; a retry under the same idempotency key returns the same PaymentIntent; after the customer completes Stripe's test 3-D Secure page (headless Chromium, PaymentIntent confirmed server-side) retrieval reports it succeeded; a card that declines when charged is a declined attempt that its key does not charge again, and the retry under a new key with another card succeeds once. Breaking the action-required mapping fails the run. Remaining: the usage page's own Stripe.js verification step against real Stripe, which needs a test-mode `STRIPE_PUBLISHABLE_KEY`; none is configured in the workspace.

## 6. Operations, documentation, and compatibility

- [x] 6.1 Make deploy checks, webhook configuration, Stripe catalog-push steps, mock payments, and required environment variables depend on the selected adapter rather than Stripe-only assumptions; verify deploy, build-step, and local mock test suites.
- [x] 6.2 Add `sites/docs/content/docs/building-a-site/payment-providers.md` with the complete adapter contract, how a site module implements and registers provider operations and declares secrets/webhooks, capability checks, the existing Markdown-to-Stripe catalog flow, and a minimal site-owned mock/test example; update the store, memberships, usage-billing, edge-functions, config-keys, and environment-variables pages to link to it; verify `node packages/kit/build/docs-check.mjs`.
- [x] 6.3 Verify existing sites with no provider setting still deploy and run Stripe checkout, Markdown catalog push, and webhooks with their current `STRIPE_*` secrets; verify docs guard, deploy checks, and the Stripe regression suite. Default-provider deployment, checkout/catalog regression, and Stripe adapter signature cases passed. The live webhook-door run against the correct demo stack passed all 20 payment signature/refusal and no-write assertions; its only failure was the unrelated audio-storage policy probe (`42P10`).

## 7. Cross-cutting verification

- [x] 7.1 Run every scenario in `payment-providers` and `platform-data` and record each as passed, failed, or not verified; run focused commerce, checkout-parameter, usage, webhook, payout, migration, deployment, and docs checks, resolving regressions before marking the change complete.

### Verification record

**Passed:** provider contract and Stripe adapter tests; checkout parameters (29); ledger (33); usage unit checks; payouts (58) and payout ledger checks (44); schema checks (43); webhook unit checks (10); deployment checks (112); docs guard (88 pages); demo assembly check; live payment webhook-door and no-write assertions (20); fresh isolated provider-reference, usage, and payout database tests.

**Not verified:** migration preservation against a populated legacy Stripe database; live Hyperswitch multi-connector sandbox routing and connected-account payouts. A fresh isolated test stack was created for the database checks; no existing database was reset. The broader live door script still has one unrelated audio-storage policy failure (`42P10`).
