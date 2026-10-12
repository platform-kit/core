---
title: Usage billing
description: Sell prepaid usage or bill measured SaaS usage through the same product files and Stripe catalog.
order: 23
sources:
  [
    packages/kit/build/catalog.mjs,
    packages/kit/build/usage.test.mjs,
    packages/kit/build/usage-db.test.mjs,
    packages/kit/build/site.mjs,
    packages/kit/build/bots.mjs,
    packages/kit/build/bots-db.mjs,
    packages/kit/build/deploy-checks.mjs,
    packages/kit/build/models/core/collections.mjs,
    packages/kit/build/velite.mjs,
    packages/kit/supabase/schemas/40-commerce.sql,
    packages/kit/supabase/schemas/95-copilot.sql,
    packages/kit/supabase/schemas/96-agents.sql,
    packages/kit/supabase/functions/_shared/usage-stripe.mjs,
    packages/kit/supabase/functions/_shared/inference-meter.mjs,
    packages/kit/supabase/functions/_shared/usage-gate.mjs,
    packages/kit/supabase/functions/_shared/usage.ts,
    packages/kit/supabase/functions/_shared/usage-topup.mjs,
    packages/kit/supabase/functions/_shared/offers.ts,
    packages/kit/supabase/functions/_shared/ledger.ts,
    packages/kit/supabase/functions/_shared/agents/provider.js,
    packages/kit/supabase/functions/_shared/copilot/grant.js,
    packages/kit/supabase/functions/_shared/copilot/speech-proxy.js,
    packages/kit/supabase/functions/create-checkout-session,
    packages/kit/supabase/functions/stripe-webhook,
    packages/kit/supabase/functions/usage-meter-report,
    packages/kit/supabase/functions/agent-run,
    packages/kit/supabase/functions/copilot-llm,
    packages/kit/supabase/functions/copilot-speak,
    packages/kit/supabase/functions/usage-topup,
    packages/movable-types/src/App.vue,
    packages/movable-types/src/layouts/SiteLayout.vue,
    packages/movable-types/src/pages/UsagePage.vue,
    packages/movable-types/src/pages/VoicePage.vue,
    packages/movable-types/src/components/UsageAdmin.vue,
    packages/movable-types/src/components/AnalyticsAdmin.vue,
    packages/movable-types/src/content/ui/usage.md,
    packages/movable-types/src/content/ui/auth.md,
    packages/movable-types/src/content/ui/analytics.md,
    packages/movable-types/src/content/ui/copilot.md,
  ]
---

Usage billing lets a site sell an allowance of a service or charge for measured use. It uses the
same product records as the rest of the store: Stripe is reconciled from those records, while
stable offer keys keep existing customers and usage tied to the offer they bought.

## Choose how to sell it

Add a `usage` block to a product in **Sales → Products**. It names the unit and its expected
provider cost in USD for one whole unit. The price on the product remains the amount the customer
pays.

| Model                | Product fields                                                                                                                  | What the customer gets                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Prepaid pack         | A one-time `billing` offer, `usage.unit`, `usage.rate`, and `usage.grant`                                                       | A fixed quantity added when payment succeeds. Usage consumes that balance.                                            |
| Metered subscription | A `billing: subscription` offer, `usage.unit`, `usage.rate`, `usage.meter`, `usage.overagePrice`, and optional `usage.included` | The regular subscription price plus the allowance, if any. Usage beyond the allowance is added to the Stripe invoice. |

`usage.speechCostPerSecond` is optional. It records the site's declared cost for endpoint speech
without asking the browser to report money. The `usage` block belongs on the offer that pays for
the service; a bot may refer to that offer using its stable eight-character key in `billing`.

## Keep the offer's identity

The product's `sku` is its editable address. Its `key` is its lasting identity: purchases,
subscriptions, usage grants and usage events use that key even if the product is renamed. Stripe
products and prices carry the key and a snapshot of the usage settings that created them.

Changing a price or meter creates or reuses the corresponding Stripe object and retires an old
price rather than rewriting what a customer already has. A later invoice uses the metered price's
saved metadata for its allowance, unit, rate and meter name; it does not infer those facts from
today's product file. Existing offers without a `usage` block keep the ordinary one-price checkout
path.

## What is measured

Any server-side operation can use the same usage gate; it does not need to be a bot or belong to a
chat surface. The server checks the reader's verified account and stable offer, reserves enough
prepaid units for bounded work or checks the matching active metered subscription, and only then
calls the paid provider. Completed model calls are measured from provider token usage and the
server's price schedule. A spoken assistant also records endpoint speech from server-observed
audio size and sample rate. Browser speech-recognition time is optional zero-cost telemetry, not a
provider charge. Interrupting a streamed endpoint utterance records site cost for the PCM already
delivered, while settling zero billable units for that interrupted utterance. The client never
supplies the price, billable amount, account identity or Stripe customer.

Every grant and completed usage event is stored once and balances are calculated from those
records. A repeated payment or completed step does not grant or charge twice. Readers use
**`/app/usage`** to see balances and recent activity from every configured operation, buy eligible
prepaid packs, and manage their saved payment method. The automatic top-up controls appear only
when the site enables the feature and has eligible packs; each reader separately chooses a pack,
low-balance threshold, off-session consent and their own monthly spend cap. Declined or
authentication-required payment grants no units, and the operation waits for confirmed payment.
**Analytics → Usage** shows measured provider costs, customer unit prices and Stripe reports that
need attention.

## Site-owned inference costs and billing

Inference providers, their fallback order, model tariffs and default markup belong to the site in
`platformkit.config.js`; credentials are references to deployment environment variables, not
values in the config. OpenAI-compatible responses may provide token counts, but their dollar-cost
fields are not treated as an authoritative charge. The server calculates provider cost from the
measured usage dimensions and the tariff for the provider and model that actually handled each
attempt.

Each inference surface uses its own stable operation ID in `usage.operations`. The site can make
one operation site-funded and another use a prepaid or metered offer, even when both call the same
model. For a reader-billed operation, the server reserves enough offer units for every configured
fallback attempt before it contacts a provider. If that reservation is refused, no provider call
is made. Customer markup is applied per attempt, with operation markup overriding offer markup
and offer markup overriding the site's default.

Measured attempts settle from their provider/model tariff. If a provider may have processed a
request but returns no valid usage, the attempt is charged at its reserved maximum and marked as
estimated; an attempt known not to have been sent costs nothing. Fallback attempts remain
separate in the ledger, and unused authorization is released after settlement. **Analytics →
Usage** reports provider cost, markup, reader units, offer retail value and estimated-attempt
counts separately. Site-funded attempts appear as provider spend without reader units.

## Stripe reports that need attention

Usage is recorded before its overage is sent to Stripe. A scheduled report retries a pending
event with the same identifier only inside Stripe's identifier-deduplication window. If that
window expires without confirmation, automatic retries stop: the event remains visible under
**Analytics → Usage** for manual reconciliation. The administrator's retry action sends only
reports that are still safe to retry; an expired report must be checked against Stripe before it
is resolved.

## Deploy and verify

A live Stripe secret and webhook signing secret are required only when a published offer is
metered. Sites with no published metered offer do not need meter configuration. The targeted
checks are `node packages/kit/build/usage.test.mjs`,
`node packages/kit/build/deploy-checks.mjs --test`, and `node packages/kit/build/assemble.mjs
--check` from the site directory. The database integration check,
`node packages/kit/build/usage-db.test.mjs`, needs a local database with the declared schema
already applied; do not run a database reset merely to test it if that would erase data.
