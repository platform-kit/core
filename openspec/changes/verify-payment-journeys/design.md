# Design

## Context

- Unit and database suites already pin the payment rules: `ledger.test.mjs` (what a payment grants), `money-db.test.mjs` (a payment arriving twice is one purchase), `orders-db.test.mjs`, `promotions-db.test.mjs`, `usage-db.test.mjs`, `payouts-db.test.mjs`, `webhooks.test.mjs`, and `webhook-doors.test.mjs` (unsigned bodies refused).
- `stripe-testmode.integration.mjs` exercises each Stripe adapter operation against test mode (customers, catalog, checkout sessions, plan changes, cancellation, the portal, metering, top-up, refunds), and `stripe-usage-recovery.integration.mjs` the incremental usage charge's recovery. Neither carries a payment through the webhook, the ledger and the grants to what the site then shows.
- `stripe-webhook/index.ts` applies the provider's verified events (`checkout.completed`, `subscription.*`, `invoice.paid`, `invoice.payment-failed`, `payment.refunded`, …). It calls itself the reconciliation engine, but only applies what arrives; nothing compares the ledger with the provider's records.
- Modules schedule work as pg_cron jobs in their manifest (`build/modules/kit.mjs`, for example `payouts-sweep` and `hyperswitch-subscription-renewal`), each a SQL command that runs a `run_*()` function.

## Decisions

**One opt-in runner over the local stack and test mode.** `build/stripe-journeys.integration.mjs` takes a private env file, refuses any key that is not test mode before sending a request, and runs each journey through the site: checkout created by the site's own function, payment completed as a customer would, then the outcome read where a customer sees it (the reader's access, downloads, the Billing page). Like the existing test-mode runners, it is not part of `npm test`.

**Getting real events to the local site.** The provider's events must reach the local webhook. With the Stripe CLI installed, the runner uses `stripe listen` and its signing secret. Without it, the runner reads the genuine events from Stripe's events API and delivers them to the local webhook signed with the local endpoint's secret, which is how the CLI itself delivers them. The event bodies are always Stripe's own; nothing is fabricated.

**Time.** Renewals, trials and period ends use Stripe's test clocks, so a month passes in seconds.

**The browser step.** The usage page's verification runs in headless Chromium with the site's Stripe.js and a test-mode publishable key, completing Stripe's test 3-D Secure page as `stripe-3ds-complete.mjs` already does. Without the key it is reported as not run.

**Reconciliation is a report, not a repair.** A nightly `payments-reconcile` job (module `store`, provider-agnostic) asks the selected provider's adapter for its records over a recent window through a new optional `listRecords` capability, compares them with orders, transactions, grants and subscriptions, and writes each difference to a `payment_differences` record keyed by provider and external id, so a second run updates rather than duplicates. It writes nothing else. The Payments screen lists open differences with a link to the provider's dashboard; a difference resolves itself when a later run no longer finds it. A provider without `listRecords` is shown as not checked.

**Language.** "Out of step with Stripe" (the provider's name), one plain line per kind of difference, and "The site and Stripe agree as of {time}." Copy lives in the theme's payments strings.

**Data ownership.** Differences are their own records with their own lifecycle (found, still found, gone), not fields on orders or subscriptions.

**Controls and motion.** A read-only list with links out; no actions in the app.

## Deliberately not built

- **Automatic correction.** A wrong automatic grant or revoke is worse than a listed difference; a person checks the provider first.
- **Notifications.** Proposed as a follow-up once the list is trusted; James to decide.
- **Hyperswitch journeys.** Its card path through Stripe needs the account owner's raw-card permission; its records are reconciled only if its adapter implements `listRecords`.

## Risks

- Test clocks and event delivery make the suite slow (minutes); it stays opt-in.
- A record created during the window but delivered after the check can appear as a difference for one run; the window excludes the most recent hour.
