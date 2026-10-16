---
title: Payment providers
description: Keep PlatformKit's shared commerce rules while a site supplies its own payment-provider code.
order: 50
sources:
  [
    packages/kit/src/payment-provider.d.ts,
    packages/kit/src/payment-provider.mjs,
    packages/kit/build/payment-provider-registry.mjs,
    packages/kit/build/modules/manifest.mjs,
    packages/kit/build/assemble.mjs,
    packages/kit/build/deploy.mjs,
    packages/kit/build/deploy-checks.mjs,
    packages/kit/build/steps.mjs,
    packages/kit/build/steps/push-catalog.mjs,
    packages/kit/build/fixtures/site-payment-provider,
    packages/kit/supabase/config.toml.template,
    packages/kit/supabase/functions/_shared/payment-provider.mjs,
    packages/kit/supabase/functions/_shared/payment-provider.d.ts,
    packages/kit/supabase/functions/_shared/payment-provider-refs.ts,
    packages/kit/supabase/functions/_shared/hyperswitch-api.mjs,
    packages/kit/supabase/functions/_shared/hyperswitch-billing.mjs,
    packages/kit/supabase/functions/_shared/hyperswitch-payment-provider.ts,
    packages/movable-types/src/lib/hyperswitch-sdk.js,
    packages/kit/supabase/functions/_shared/stripe-payment-provider.ts,
    packages/kit/supabase/functions/_shared/usage-stripe.mjs,
    packages/kit/supabase/functions/_shared/usage.ts,
    packages/kit/supabase/functions/usage-topup/index.ts,
    packages/kit/supabase/functions/_shared/payouts.ts,
    packages/kit/supabase/functions/payouts/index.ts,
    packages/movable-types/src/instrument/ui/results/ProviderEarnings.vue,
    packages/kit/supabase/functions/create-checkout-session/index.ts,
    packages/kit/supabase/functions/create-portal-session/index.ts,
    packages/kit/supabase/functions/hyperswitch-subscription-renewal,
    packages/kit/supabase/schemas/40-commerce.sql,
    packages/kit/src/lib/commerce.js,
    packages/kit/src/lib/router.js,
    packages/movable-types/src/App.vue,
    packages/movable-types/src/pages/BillingPortalPage.vue,
    packages/movable-types/src/pages/HyperswitchCheckoutPage.vue,
    packages/movable-types/src/components/UsagePanel.vue,
    packages/movable-types/src/content/ui/usage.md,
    packages/movable-types/src/pages/AdminPage.vue,
    packages/movable-types/src/components/admin/PaymentsAdmin.vue,
    packages/movable-types/src/content/ui/payments.md,
    packages/kit/build/hyperswitch-billing.test.mjs,
    packages/kit/build/hyperswitch-payment-provider.test.mjs,
    packages/kit/build/hyperswitch-payment-provider-adapter.test.ts,
    packages/kit/build/hyperswitch-sdk.test.mjs,
    packages/kit/build/hyperswitch-local.integration.mjs,
    packages/kit/build/hyperswitch-local.integration.test.ts,
    packages/kit/build/hyperswitch-test-stack.mjs,
    packages/kit/build/hyperswitch-v2-test.compose.yml,
    packages/kit/build/test.mjs,
    package.json,
    packages/kit/build/payment-provider-adapters.test.mjs,
    packages/kit/build/payment-provider-db.test.mjs,
    packages/kit/build/stripe-payment-provider.test.ts,
    packages/kit/build/stripe-testmode.integration.mjs,
    packages/kit/build/stripe-testmode.integration.test.ts,
    packages/kit/build/usage.test.mjs,
    packages/kit/supabase/functions/payment-provider-webhook,
    packages/kit/supabase/functions/push-catalog,
    packages/kit/supabase/functions/stripe-webhook,
  ]
reviewed: 2026-10-13
---

PlatformKit keeps one payment provider active per site. Stripe is the built-in provider and the
default for existing sites; a site may instead register its own server-side adapter. The adapter
speaks the provider's protocol, while PlatformKit continues to decide what the site sells, record
orders and subscriptions, grant access, and make webhook processing idempotent. There is no
processor combining, fallback, or automatic migration of customers between providers.

The core includes the existing Stripe adapter and a built-in Hyperswitch adapter. Hyperswitch
supports one-time and subscription checkout through a generic PlatformKit page using its Web SDK.
Subscription checkout requests an off-session saved payment method (including zero-amount trials);
PlatformKit confirms the result through provider retrieval or a verified webhook. The server API
key and webhook signing key never enter browser code.

PlatformKit manages Hyperswitch subscription changes, recurring periods, cancellation-at-period-end,
and the `/billing` self-service page (also available at `/app/billing`), linked from the signed-in
account menu. Immediate upgrades charge
positive prorations through Hyperswitch; a lower-priced immediate change does not issue a prorated
credit. Renewal charges use
the saved payment method and stable period-based idempotency. Prepaid usage top-ups and refunds also
use Hyperswitch. Metered usage is recorded in PlatformKit and charged at period end through the same
Hyperswitch payment path, or in separate threshold charges when the offer opts into incremental
billing. Hyperswitch does not document a native metered-usage event API, so
`usage.metered` is a PlatformKit capability and is not required in the Hyperswitch profile's
connector capability declaration. The
billing page supports plan changes, cancellation, and resuming a scheduled cancellation, but does
not replace a saved payment method. Customers can manage Hyperswitch saved methods in the Usage
section of `/billing` (`/billing#usage`). PlatformKit creates an authenticated payment-method
session on the server and mounts Hyperswitch's Vault management widget in the browser. The server API key remains private, and
Hyperswitch handles sensitive card details and any required authentication.

Unsettled incremental charges appear in the authenticated Usage section of `/billing`. If a saved
card needs additional verification, the page completes it with the selected provider's browser SDK; only a
server-verified successful payment clears the outstanding amount. A declined attempt remains
unsettled and can be retried after the saved payment method is corrected. Stripe requires
`STRIPE_PUBLISHABLE_KEY` only for sites with an offer that opts into incremental usage; ordinary
Stripe checkout does not need it.

The adapter rejects tax and tax-ID collection, adjustable quantities, and shipping collection before
creating a payment. PlatformKit owns the offer catalog and does not create Hyperswitch products or
prices. The local Hyperswitch integration runner creates a customer, creates and confirms a
test-card payment for that customer, verifies the normalized payment status, and refunds it against
a locally running service. The repository includes an opt-in Docker Compose override that builds
the router with Hyperswitch v2, OLTP, payout, and tokenization features, runs v2 migrations, and
checks the v2 health endpoint. It uses the Hyperswitch source checkout's Compose dependencies so
the normal unit suite does not need to build or start the service. For the source revision validated
by this stack, use Hyperswitch commit `89cbccdfbb7936bcf0e710f3b4ba42cb4246a3f0`.

Start the isolated stack from the PlatformKit repository, pointing at that Hyperswitch checkout:

```sh
export HYPERSWITCH_SOURCE_DIR=/path/to/hyperswitch
npm run test:hyperswitch:stack
```

The router binds to `127.0.0.1:18323` by default. Use
`PLATFORMKIT_HYPERSWITCH_TEST_PORT` to choose another local port, and
`npm run test:hyperswitch:stack:down` to stop only this Compose project.
Run the integration check with a private, untracked `.env` or JSON profile file:

```sh
npm run test:hyperswitch:local -- /path/to/private-hyperswitch.env
```

The runner accepts only a loopback HTTP origin and does not print credentials. To add this live
check to the normal test command explicitly, set
`HYPERSWITCH_LOCAL_INTEGRATION_CONFIG=/path/to/private-hyperswitch.env` when running `npm test`.
This verifies the local API and configured test connector only; it does not certify a production
profile, multiple eligible connectors, or routing behavior.

Run the deterministic adapter contract suite from the kit package:

```sh
cd packages/kit
node build/payment-provider-adapters.test.mjs
```

For real Stripe API coverage, pass a private environment file containing a test-mode
`STRIPE_SECRET_KEY`:

```sh
node packages/kit/build/stripe-testmode.integration.mjs /path/to/private-stripe-test.env
```

The runner refuses keys other than `sk_test_` before making a request. It exercises customer and
payment-method setup, catalog synchronization and idempotency, one-time and trial checkout,
promotion-code redemption, subscription plan changes and cancellation, the billing portal, metered
usage, prepaid top-up, and partial plus full refunds. It expires unfinished checkout sessions,
cancels the trial subscription, disables the promotion code and meter, and archives its generated
catalog products. Stripe does not allow archiving a product's current default price, so that
test-only price remains attached to the archived product. Connected-account payout integration is
reported as not verified when the Stripe test account has not enabled Connect; the adapter's
deterministic suite still verifies the payout request mapping.

Hyperswitch payout setup uses a dedicated Hyperswitch customer for each recipient. The recipient
adds a supported payout destination through an authenticated payment-method management session
on the Usage section of `/billing`; PlatformKit stores only the Hyperswitch customer ID and setup status. For payout
creation, the adapter uses the vaulted `payment_token` as `payout_token` with the recipient customer
and payout method type. It does not send raw card or bank details or treat the distinct
`payout_method_id` external-vault proxy route as implemented. A saved method confirms setup, but
does not prove that a payout connector is active or that a later payout will be accepted. Sites
must configure payout processors and methods in Hyperswitch and declare both `customer.create` and
`payouts.connected-accounts` when provider offerings are enabled. After an uncertain request, the
adapter retrieves the same stable payout ID before attempting creation again; nonterminal payout
statuses remain in the ledger for reconciliation and are not recorded as sent. This flow has focused
contract coverage; a live payout has not been verified because the available local profile has no
payout connector. See the
[Hyperswitch Payouts API](https://api-reference.hyperswitch.io/v1/payouts/payouts--create) and
[saved payout methods guide](https://docs.hyperswitch.io/integrations/connectors-integrations/payouts/get-started-with-payouts/process-payouts-using-saved-payment-methods).

The supported types and adapter contract are in
[`packages/kit/src/payment-provider.d.ts`](https://github.com/platform-kit/core/blob/main/packages/kit/src/payment-provider.d.ts).
The checks below are made before provider side effects. A provider must implement every method for
each capability it declares; it must not claim a capability and then silently ignore part of an
offer.

## Select one provider

Omitting the setting keeps Stripe selected. To use a site-owned provider, select its registered id
in `platformkit.config.js` and include the module that declares it:

```js
export default {
  payments: { provider: 'site-payments' },
  build: {
    modules: ['./db/modules/payment-provider.mjs'],
  },
}
```

The id must belong to an enabled site module. Unknown ids, missing adapter files, malformed
capabilities, and missing provider secrets are refused during assembly or deployment.

## Register the adapter and its secrets

A site module declares the provider id, the adapter file relative to the site's
`db/functions/_shared/` directory, supported capabilities, required server secrets, and the
standard webhook path:

```js
export default {
  key: 'site-payments',
  what: 'the site payment adapter',
  static: false,
  git: true,
  cloud: true,
  owns: { env: ['SITE_PAYMENT_SECRET'] },
  paymentProviders: [
    {
      id: 'site-payments',
      adapter: 'payment-providers/provider.ts',
      capabilities: ['checkout.one-time', 'checkout.confirm'],
      secrets: ['SITE_PAYMENT_SECRET'],
      webhookPath: '/functions/v1/payment-provider-webhook',
    },
  ],
}
```

Every name in `secrets` must also be in the module's `owns.env`. Keep these values in the site's
ignored local environment file or production deploy environment, never in the module or a
`VITE_` variable. Deployment checks require the selected provider's secrets for a site with
something for sale; deployment sends declared module environment values to the function runtime.
The assembled factory receives only the secrets named by that provider registration.

Implement the adapter in the path the module declared. This small mock is for a test fixture only;
it deliberately verifies no real webhook and is not a production payment implementation:

```js
export function createPaymentProvider(secrets) {
  if (!secrets.SITE_PAYMENT_SECRET) throw new Error('SITE_PAYMENT_SECRET is required')

  return {
    id: 'site-payments',
    capabilities: ['checkout.one-time'],
    async createCheckout(input) {
      return {
        provider: 'site-payments',
        checkoutId: input.idempotencyKey,
        url: input.successUrl,
      }
    },
    async verifyWebhook() {
      return []
    },
  }
}
```

The factory returns a server-only adapter. `verifyWebhook(request)` is always required: a real
adapter must authenticate the original request body with its own signature rules, then return
normalized events. The core route at `/functions/v1/payment-provider-webhook` applies those events
to the shared ledger. The legacy `/functions/v1/stripe-webhook` route remains available for
existing Stripe configurations. Do not trust a browser redirect as proof of payment.

## Adapter operations and capabilities

Methods are optional in the TypeScript contract; a method is required when its corresponding
capability is declared. Some capabilities describe terms a checkout must honor, not separate
methods.

| Capability                                                                                                                                                      | Adapter operation                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `checkout.one-time`, `checkout.subscription`                                                                                                                    | `createCheckout`                                                              |
| `checkout.confirm`                                                                                                                                              | `retrieveCheckout`                                                            |
| `checkout.trial`, `checkout.tax`, `checkout.payment-method-selection`, `checkout.adjustable-quantity`, `checkout.shipping-address`, `checkout.shipping-options` | `createCheckout`, honoring the requested terms                                |
| `subscription.change`, `subscription.proration`                                                                                                                 | `changeSubscription`                                                          |
| `customer.create`                                                                                                                                               | `createCustomer`                                                              |
| `customer.portal`                                                                                                                                               | `createPortalSession`                                                         |
| `catalog.sync`                                                                                                                                                  | `syncCatalog`                                                                 |
| `refunds`                                                                                                                                                       | `refund`                                                                      |
| `usage.metered`                                                                                                                                                 | `reportUsage`                                                                 |
| `usage.prepaid-top-up`                                                                                                                                          | `getDefaultPaymentMethod`, `createPaymentIntent`, and `retrievePaymentIntent` |
| `payouts.connected-accounts`                                                                                                                                    | `createPayoutAccount`, `retrievePayoutAccount`, and `createPayout`            |

Each operation uses PlatformKit's normalized inputs and results: checkout requests carry offer
keys, quantities, requested tax/shipping terms, and an idempotency key; checkout and subscription
snapshots describe the provider result without making the provider catalog authoritative. The
Hyperswitch webhook adapter maps documented payment, refund, invoice, and payout events; it does
not invent subscription-lifecycle or usage events. Hyperswitch documents `invoice_paid` as its
subscription-related webhook and does not define a usage event type. Non-terminal payment events
such as processing or authorization do not grant access, and a platform checkout is expired only
when a signed cancellation/expiry event carries PlatformKit's checkout metadata. Unsupported
options are rejected before a request or ledger claim. Hyperswitch itself routes each payment
through the connectors and rules configured in the selected profile; PlatformKit does not select a
connector or hold its credentials.

## Hyperswitch configuration

Select Hyperswitch as the site's one payment provider and list the capabilities verified for its
business profile. The built-in adapter implements checkout and PlatformKit-managed subscription
billing, but the Hyperswitch sandbox, multi-connector routing, and production profile have not been
verified. Complete those checks before using it for production sales. For provider offerings, add
`customer.create` and `payouts.connected-accounts` only after configuring payout processors and
supported payout methods in the Hyperswitch profile; a saved method alone does not prove that the
profile can execute a payout.

```js
export default {
  payments: {
    provider: 'hyperswitch',
    profileCapabilities: [
      'checkout.one-time',
      'checkout.subscription',
      'checkout.confirm',
      'checkout.trial',
      'checkout.payment-method-selection',
      'customer.create',
      'refunds',
      'usage.prepaid-top-up',
    ],
  },
}
```

The selected profile must be configured in Hyperswitch with eligible payment and payout connectors,
payment methods, and routing rules. `profileCapabilities` is the site's assertion about
provider-backed behavior and must be a subset of the capabilities implemented by the built-in
adapter. Unsupported capabilities are rejected before their operations run. PlatformKit-managed
subscription scheduling, usage accounting, and the billing page do not need to be asserted as
native Hyperswitch features. Hyperswitch does not provide an aggregate capability query for a
profile. PlatformKit keeps its catalog and offer files authoritative and does not create
Hyperswitch products or prices.

Set `HYPERSWITCH_BASE_URL`, `HYPERSWITCH_API_KEY`, `HYPERSWITCH_PROFILE_ID`, and
`HYPERSWITCH_PUBLISHABLE_KEY` and `HYPERSWITCH_WEBHOOK_SECRET` in the server environment. The API
key and webhook signing key never enter browser assets; the publishable key and one payment's client
secret are used only on the checkout page. By default, the page loads the hosted Hyperswitch Web
SDK. Optionally set `HYPERSWITCH_CLIENT_URL` to use a self-hosted Web SDK; local development may use
a loopback HTTP URL, while deployed sites require HTTPS. The webhook secret is the profile's
`payment_response_hash_key`. Do not set Stripe credentials for a Hyperswitch site. The adapter
authenticates the raw webhook body before normalizing events. Checkout is a focused, branded page
with an order summary and secure payment form; invalid or expired links provide a clear return to
the store.

## Payment controls in admin

The admin Payments page shows the selected provider, the Hyperswitch capabilities declared for the
site, and a validated Control Center link when `payments.controlCenterUrl` is configured. It also
links to orders and, for Stripe, the Stripe Dashboard. It is an operations overview, not a place to
edit provider credentials or profile capabilities: keep API and webhook keys in the server
environment, change `profileCapabilities` in the site configuration, and manage connectors and
routing in Hyperswitch. The page shows the recipient's payout setup state; it cannot inspect or
configure the Hyperswitch payout connector itself.

## Keep the offer files authoritative

The existing Stripe path remains `content/store/products/*.md` → `catalog.json` →
`push-catalog`. Stripe is still the compatibility default, and the site files remain the source
of truth for prices, product identity, and access rules. A custom provider that needs mirrored
products or prices can declare `catalog.sync` and implement `syncCatalog`; then the same build
step calls the selected adapter. A provider that does not need catalog mirroring leaves that
capability out, and the catalog-push step is skipped.

Payment references and webhook event ids are stored with provider identity, so two providers
returning the same external id cannot share a customer, purchase, subscription, or event marker.
Existing Stripe references keep their Stripe identity and their established checkout behavior.

The site-owned mock used to check module registration and assembly is in
[`packages/kit/build/fixtures/site-payment-provider`](https://github.com/platform-kit/core/tree/main/packages/kit/build/fixtures/site-payment-provider).
See [the store](/content/docs/running-a-site/selling/store),
[memberships and pricing](/content/docs/running-a-site/selling/memberships-and-pricing),
[usage billing](/content/docs/running-a-site/selling/usage-billing),
[edge functions](/content/docs/building-a-site/edge-functions),
[configuration keys](/content/docs/reference/config-keys), and
[environment variables](/content/docs/reference/environment-variables) for the behavior at each
payment surface.
