---
title: Usage billing
description: Sell prepaid usage or bill measured SaaS usage through the same product files and selected payment provider.
order: 23
sources:
  [
    packages/kit/build/catalog.mjs,
    packages/kit/src/lib/usage-unit.js,
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
    packages/kit/supabase/functions/_shared/usage-incremental.mjs,
    packages/kit/supabase/functions/_shared/usage-incremental-recovery.mjs,
    packages/kit/supabase/functions/_shared/usage-incremental.ts,
    packages/kit/supabase/functions/_shared/payment-provider.mjs,
    packages/kit/src/payment-provider.d.ts,
    packages/kit/build/payment-provider-registry.mjs,
    packages/kit/supabase/functions/_shared/inference-meter.mjs,
    packages/kit/supabase/functions/_shared/usage-gate.mjs,
    packages/kit/supabase/functions/_shared/usage.ts,
    packages/kit/supabase/functions/hyperswitch-subscription-renewal/index.ts,
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
    packages/kit/theme/src/App.vue,
    packages/kit/theme/src/layouts/SiteLayout.vue,
    packages/kit/theme/src/pages/BillingPortalPage.vue,
    packages/kit/theme/src/components/UsagePanel.vue,
    packages/kit/theme/src/lib/usage-eligibility.js,
    packages/kit/src/lib/router.js,
    packages/kit/theme/src/pages/VoicePage.vue,
    packages/kit/theme/src/components/UsageAdmin.vue,
    packages/kit/theme/src/components/AnalyticsAdmin.vue,
    packages/kit/theme/src/content/ui/usage.md,
    packages/kit/theme/src/components/UsagePaymentAlert.vue,
    packages/kit/src/lib/usage-alert.js,
    packages/kit/build/usage-alert.test.mjs,
    packages/kit/theme/src/content/ui/auth.md,
    packages/kit/theme/src/content/ui/analytics.md,
    packages/kit/theme/src/content/ui/copilot.md,
  ]
reviewed: 2026-10-22
---

Usage billing lets a site sell an allowance of a service or charge for measured use. It uses the
same product records as the rest of the store: the selected payment provider reports and reconciles
usage against those records, while stable offer keys keep existing customers and usage tied to the
offer they bought. Stripe remains the built-in default. See [Payment providers](/content/docs/building-a-site/payment-providers)
for the adapter operations and capabilities.

Provider-native metering reports require the selected adapter's `usage.metered` capability.
Hyperswitch instead records metered usage in PlatformKit and settles it through its payment API;
incremental charges use that same saved-method payment path. Automatic prepaid top-ups use the
provider's payment-intent operations, and their stored provider identity prevents a reused external
payment-intent id from crossing provider boundaries.

## Choose how to sell it

Add a `usage` block to a product in **Sales → Products**. Its `rate` is the expected provider cost
in USD for one whole usage unit; the price on the product remains the amount the customer pays.
The unit is optional: if `usage.unit` is omitted or blank, PlatformKit uses **credits**, and the
declared rate applies per credit. Set `usage.unit` when a different unit is more meaningful.

| Model                | Product fields                                                                                                                                                                        | What the customer gets                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Prepaid pack         | A one-time `billing` offer, `usage.rate`, `usage.grant`, and optional `usage.unit` (defaults to `credits`)                                                                            | A fixed quantity added when payment succeeds. Usage consumes that balance.                                                     |
| Metered subscription | A `billing: subscription` offer, `usage.rate`, `usage.meter`, `usage.overagePrice`, and optional `usage.unit` (defaults to `credits`), `usage.included`, or `usage.incrementalCharge` | The regular subscription price plus the allowance, if any. Usage beyond the allowance is billed through the selected provider. |

## When readers see Usage

The authenticated `/billing` page shows its Usage tab only when the site publishes a metered
subscription offer. A prepaid pack by itself does not enable the tab. Reader membership, past
usage, balances, or top-up settings do not enable it either. When a metered subscription is
published, every signed-in reader can open Usage, including readers with no usage data; the page
then shows its existing empty states. If the site has no published metered subscription, Billing
shows Membership only, including when a reader follows the former `/app/usage` route.

Set `usage.incrementalCharge` when the site wants separate charges as usage grows. For example,
`incrementalCharge: 100` charges each full $100 of metered usage as a separate off-session
transaction; any remaining amount is charged once when the billing period closes. The value is in
the offer's currency, and requires a saved payment method that can be charged off-session. This is
an actual charge, not an increase to an authorization hold. Without this setting, the existing
provider usage-billing behavior is unchanged.

If an incremental charge needs card verification or is declined, it remains unsettled and is shown
in the Usage tab of the reader's authenticated **`/billing`** page. The reader can complete card verification
through the selected provider or retry a declined charge after correcting the saved payment method.
An uncertain or still-processing payment keeps the same idempotent attempt until its provider
result is known. Stripe customers can use its billing portal to update the saved method;
Hyperswitch customers can manage saved methods securely from this page using Hyperswitch Vault.

**The reader is told on every page.** While an incremental charge needs verification or has failed, a
signed-in reader sees a red banner at the top of every page — "Payment needed", what is wrong, and
**Review payment**, linking to Billing → Usage. Its × hides it for that page only; the next page
brings it back, until the charge is settled. A charge that is only processing raises no banner, and
the banner stays off the checkout, embeds, and preview and share renders. It asks the usage function
whether a payment needs the reader once when the site opens and again on sign-in, and the Usage tab
updates it as soon as a payment settles. Its words are the `alert` group of the `usage` strings.

`usage.speechCostPerSecond` is optional. It records the site's declared cost for endpoint speech
without asking the browser to report money. The `usage` block belongs on the offer that pays for
the service; a bot may refer to that offer using its stable eight-character key in `billing`.

## Keep the offer's identity

The product's `sku` is its editable address. Its `key` is its lasting identity: purchases,
subscriptions, usage grants and usage events use that key even if the product is renamed. When
catalog synchronization is supported, provider products and prices carry the key and a snapshot
of the usage settings that created them.

With Stripe selected, changing a price or meter creates or reuses the corresponding Stripe object
and retires an old price rather than rewriting what a customer already has. A later invoice uses the metered price's
saved metadata for its allowance, unit, rate, meter name, and incremental-charge threshold; it does not infer those facts from
today's product file. The incremental threshold and its currency therefore stay fixed for an
existing subscription when the offer is edited. PlatformKit also snapshots those incremental terms
on measured usage, so earlier events cannot be reclassified by a later offer edit. Existing offers
without a `usage` block keep the ordinary one-price checkout path.

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
records. A repeated payment or completed step does not grant or charge twice. Billing presents
Membership and Usage in separate tabs. Signed-in readers see the Usage tab when the site has a
published usage offer or their account has usage balances, activity, or settings; a membership is
not required. Readers use **`/billing#usage`** to open it, and the former **`/app/usage`** address
redirects there while preserving payment and payout return parameters. The tab shows balances and
recent activity from every configured operation and lets readers buy eligible prepaid packs and
manage their saved payment method. The automatic top-up controls appear only
when the site enables the feature and has eligible packs; each reader separately chooses a pack,
low-balance threshold, off-session consent and their own monthly spend cap. Declined or
authentication-required payment grants no units, and the operation waits for confirmed payment.
The cap is tracked independently for each payment provider if a site changes providers mid-month.
**Analytics → Usage** shows measured provider costs, customer unit prices and provider reports that
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

## Provider reports that need attention

Usage is recorded before its overage is sent to the selected provider. With Stripe, a scheduled
report retries a pending event with the same identifier only inside Stripe's identifier-deduplication window. If that
window expires without confirmation, automatic retries stop: the event remains visible under
**Analytics → Usage** for manual reconciliation. The administrator's retry action sends only
reports that are still safe to retry; an expired Stripe report must be checked with Stripe before it
is resolved.

## Deploy and verify

A site needs the selected adapter's declared server secrets when something is for sale. Stripe's
live secret and webhook signing secret remain required when Stripe is selected; provider-native
meter reports require the adapter's `usage.metered` capability. Hyperswitch-managed metering uses
PlatformKit's usage records and does not require a Hyperswitch native-meter declaration. Incremental
charges require a subscription with a saved off-session payment method. Sites with no published
metered offer do not need meter configuration. The targeted
checks are `node packages/kit/build/usage.test.mjs`,
`node packages/kit/build/deploy-checks.mjs --test`, and `node packages/kit/build/assemble.mjs
--check` from the site directory. The database integration check,
`node packages/kit/build/usage-db.test.mjs`, needs a local database with the declared schema
already applied; do not run a database reset merely to test it if that would erase data.
