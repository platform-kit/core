---
title: Payment providers
description: Keep PlatformKit's shared commerce rules while a site supplies its own payment-provider code.
order: 50
sources:
  [
    packages/kit/src/payment-provider.d.ts,
    packages/kit/src/payment-provider.mjs,
    packages/kit/build/payment-provider-registry.mjs,
    packages/kit/build/payment-provider-registry.test.mjs,
    packages/kit/build/site-payment-provider.test.mjs,
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
    packages/kit/theme/src/lib/hyperswitch-sdk.js,
    packages/kit/supabase/functions/_shared/stripe-payment-provider.ts,
    packages/kit/supabase/functions/_shared/usage-stripe.mjs,
    packages/kit/supabase/functions/_shared/usage.ts,
    packages/kit/supabase/functions/usage-topup/index.ts,
    packages/kit/supabase/functions/_shared/payouts.ts,
    packages/kit/supabase/functions/payouts/index.ts,
    packages/kit/theme/src/instrument/ui/results/ProviderEarnings.vue,
    packages/kit/supabase/functions/create-checkout-session/index.ts,
    packages/kit/supabase/functions/create-portal-session/index.ts,
    packages/kit/supabase/functions/hyperswitch-subscription-renewal,
    packages/kit/supabase/schemas/40-commerce.sql,
    packages/kit/src/lib/commerce.js,
    packages/kit/src/lib/router.js,
    packages/kit/theme/src/App.vue,
    packages/kit/theme/src/pages/BillingPortalPage.vue,
    packages/kit/theme/src/pages/HyperswitchCheckoutPage.vue,
    packages/kit/theme/src/components/UsagePanel.vue,
    packages/kit/build/hyperswitch-sdk.test.mjs,
    sites/demo/supabase/config.toml,
    packages/kit/theme/src/content/ui/usage.md,
    packages/kit/theme/src/pages/AdminPage.vue,
    packages/kit/theme/src/components/admin/PaymentsAdmin.vue,
    packages/kit/theme/src/content/ui/payments.md,
    packages/kit/build/hyperswitch-billing.test.mjs,
    packages/kit/build/hyperswitch-payment-provider.test.mjs,
    packages/kit/build/hyperswitch-payment-provider-adapter.test.ts,
    packages/kit/build/hyperswitch-sdk.test.mjs,
    packages/kit/build/hyperswitch-local.integration.mjs,
    packages/kit/build/hyperswitch-local.integration.test.ts,
    packages/kit/build/hyperswitch-test-stack.mjs,
    packages/kit/build/hyperswitch-v2-test.compose.yml,
    packages/kit/build/hyperswitch-fake-processor.mjs,
    packages/kit/build/hyperswitch-browser.integration.mjs,
    packages/kit/build/hyperswitch-browser.steps.ts,
    packages/kit/build/test.mjs,
    package.json,
    packages/kit/build/payment-provider-adapters.test.mjs,
    packages/kit/build/payment-provider-db.test.mjs,
    packages/kit/build/stripe-payment-provider.test.ts,
    packages/kit/build/stripe-testmode.integration.mjs,
    packages/kit/build/stripe-testmode.integration.test.ts,
    packages/kit/build/stripe-usage-recovery.integration.mjs,
    packages/kit/build/stripe-usage-recovery.integration.test.ts,
    packages/kit/build/stripe-3ds-complete.mjs,
    packages/kit/build/usage.test.mjs,
    packages/kit/supabase/functions/payment-provider-webhook,
    packages/kit/supabase/functions/push-catalog,
    packages/kit/supabase/functions/stripe-webhook,
  ]
reviewed: 2026-10-20
---

PlatformKit keeps one payment provider active per site. Stripe is the built-in provider and the
default for existing sites; a site may instead register its own server-side adapter. The adapter
speaks the provider's protocol, while PlatformKit continues to decide what the site sells, record
orders and subscriptions, grant access, and make webhook processing idempotent. There is no
processor combining, fallback, or automatic migration of customers between providers.

The core includes the existing Stripe adapter and a built-in Hyperswitch adapter. Its browser flow
uses the official Hyperswitch Web SDK's secure card fields: card details go straight from the
customer's browser to Hyperswitch's Vault and never reach PlatformKit. The SDK returns a short-lived
payment-method token, and the checkout page confirms the payment with
`/v2/payments/{id}/confirm-intent` using that token (`payment_token` plus a vaulted `card_token`).
The adapter does not use the SDK's V1 payment-confirm helper and does not accept Stripe.js tokens.
The adapter calls the Router's V2 API: `/v2/payments` and `/v2/refunds` for payments and refunds.
Customers, payment-method sessions, and saved methods belong to the Router's payment-method service
group, which the Router serves under one configurable prefix (`payment_methods_prefix`).
Hyperswitch's [Vault SDK guide](https://docs.hyperswitch.io/integration-guide/payment-experience/vault-then-pay/web/vault-sdk-js-with-rest-api-integration.md)
creates the session at `/v1/payment-method-sessions`, and the Web SDK addresses that same path, so the
adapter defaults to `v1` (`/v1/customers`, `/v1/payment-method-sessions`, and saved methods) and the
Router must be configured to match: `ROUTER__MICRO_SERVICES__PAYMENT_METHODS_PREFIX=v1`. A Router left
on its stock `v2` prefix needs `HYPERSWITCH_PAYMENT_METHODS_PREFIX=v2`, but the SDK's card fields
then have nothing to call, so that setting is only for non-card use.

With the SDK's card fields, checkout sessions are persistent, for one-time purchases as well as subscriptions. The V2 Router
resolves a payment token from its database, so a volatile (Redis-only) session cannot be confirmed
with `confirm-intent`. A persistent session needs a running Hyperswitch Card Vault (`locker.host`),
because the Router vaults the card there. A one-time purchase would therefore leave the vaulted card
on the customer record, so once such a purchase is retrieved as paid the adapter deletes the card
saved during that checkout. It never deletes a card that existed before the payment, subscription
checkouts keep theirs, and a failed deletion is retried on the next retrieval.

A self-hosted Router needs a Web SDK built for it: the SDK's content-security policy only allows
the backend origins it was built with (its build-time backend URL setting), and `HYPERSWITCH_CLIENT_URL` points at
that build. The hosted SDK cannot call a private Router.

**Stripe-backed profiles need Stripe's approval.** With the Hyperswitch SDK's card fields the Router
sends the card number to Stripe. Stripe rejects that ("Sending credit card numbers directly to the
Stripe API is generally unsafe") until raw card data APIs are enabled for the account, which only
Stripe support can do ([Enabling access to raw card data APIs](https://support.stripe.com/questions/enabling-access-to-raw-card-data-apis)).
For testing only, support enables it without compliance documents; for live mode Stripe asks for
documentation, and Hyperswitch's [PCI compliance page](https://docs.hyperswitch.io/other-features/security-and-compliance/pci-compliance.md)
says to share Hyperswitch's PCI Attestation of Compliance. Hyperswitch's [Stripe connector guide](https://docs.hyperswitch.io/other-features/connectors/available-connectors/stripe.md)
lists this as a prerequisite. PlatformKit has no workaround for this. The Router has no input for a Stripe-issued token
(`pm_...` or `tok_...`); a payload that disguises one as another payment method would misrepresent
the payment, so it is not offered. Hyperswitch documents Stripe.js tokens only for Prism, its stateless
connector library
([Connector Token](https://docs.hyperswitch.io/integrations/prism/prism/payment-methods/connector-token.md)),
which has no routing, vault, retries, or stored state, calls Stripe with a Stripe secret key that
PlatformKit would then hold, and, because its Node package loads a native library through FFI, would
have to run as its standalone gRPC microservice to be called from the Supabase Edge Functions. That
would be a separate adapter, not a change to this one.

**A local fake processor for end-to-end tests.** The Router's built-in test connectors (fauxpay and
friends) are not served by a V2 build, so `packages/kit/build/hyperswitch-fake-processor.mjs` is a small
Stripe-shaped test double: run it (`node packages/kit/build/hyperswitch-fake-processor.mjs 12111`), point
the Router's `stripe.base_url` at it, and the whole card path runs without Stripe's raw-card approval.
It accepts card numbers, declines `4000000000000002`, and supports retrieval and refunds. It proves
the Router, SDK, Card Vault, adapter, retrieval, one-time card cleanup, and refund paths work together; it
says nothing about Stripe, and a result from it must never be reported as a Stripe result. Run against
it in a real browser, a card entered in the SDK fields was vaulted and paid, retrieved as paid through
V2, its saved card deleted, and then refunded; the declined card showed the checkout's error message
and stayed on the checkout page. That run is `node packages/kit/build/hyperswitch-browser.integration.mjs
<private.json>`, where the private file names the running Router, its profile keys, and the SDK URL and
never leaves the machine; it also asserts that no request to the site carried the card number.

Verified in a real browser against a local V2 Router, Card Vault, and self-hosted SDK: the secure
card fields render, the card is vaulted, and the page calls `confirm-intent` with the token, so the
Router sends the payment to the Stripe connector, which Stripe then refuses until raw card handling is
enabled. A V2 payment on the same Stripe test connector confirmed with a Stripe test token succeeded,
retrieved as paid, and refunded, but that run used a payload the product does not ship, so it only
shows that the Router, retrieval, and refund paths work. **A Stripe connector behind Hyperswitch
needs the Stripe account to accept card data from Hyperswitch** — Hyperswitch's Stripe connector guide
lists it as a prerequisite, and the account owner asks Stripe to enable it. That is an operator
prerequisite outside PlatformKit, so PlatformKit's browser verification is the fake-processor run
above, and a Stripe-accepted card through the documented SDK path is not claimed. Do not treat unit tests or the card-free Router smoke test
as proof of a successful payment. The configured Stripe connector must use a test key before any
paid test.
Compare the official [React demo client](https://github.com/juspay/hyperswitch-web/blob/b7ee7e48bf1e55036ffaa3bad313aab8a9df2ab7/Hyperswitch-React-Demo-App/src/Payment.js),
[demo server](https://github.com/juspay/hyperswitch-web/blob/b7ee7e48bf1e55036ffaa3bad313aab8a9df2ab7/Hyperswitch-React-Demo-App/server.js),
[SDK card-confirm helper](https://github.com/juspay/hyperswitch-web/blob/b7ee7e48bf1e55036ffaa3bad313aab8a9df2ab7/src/Utilities/PaymentHelpers.res),
and [SDK payment-element renderer](https://github.com/juspay/hyperswitch-web/blob/b7ee7e48bf1e55036ffaa3bad313aab8a9df2ab7/src/PaymentElementRenderer.res).
Also see Hyperswitch's [Headless SDK guide](https://docs.hyperswitch.io/integration-guide/payment-experience/pay-then-vault/web/headless-sdk.md),
[SDK payment-flow overview](https://docs.hyperswitch.io/about-hyperswitch/sdk-payment-flows.md),
[Token Led Payment guide](https://docs.hyperswitch.io/integration-guide/payment-suite/payment-method-card/payments.md),
and [server-to-server payments guide](https://docs.hyperswitch.io/integration-guide/payment-suite/server-to-server-payments.md).
The Token Led guide's payment confirmation is V1; PlatformKit does not use that confirmation path.
The V2 `payment_link_enabled` flag still returns no hosted URL from the tested Router, and the V2
`card_token` variant refers to Hyperswitch-vaulted data rather than a Stripe.js token. Server API
and webhook signing keys remain server-side. A Hyperswitch event is verified over its raw bytes and
refused when it is dated more than three days before it arrives (`HYPERSWITCH_WEBHOOK_TOLERANCE_S`):
its event id is forgotten when handling fails, so an old event replayed later is refused by its date.

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
not replace a saved payment method. The Usage section of `/billing` (`/billing#usage`) has a Hyperswitch saved-method flow that creates
an authenticated payment-method session on the server and mounts the SDK's payment-method fields.
Saved-method management needs the same Router, Vault, and SDK setup as checkout and has not been
verified end to end.

Unsettled incremental charges appear in the authenticated Usage section of `/billing`. A saved card
that needs additional verification requires a compatible provider browser SDK; this recovery step
is not verified for Hyperswitch V2. Only a server-verified successful payment clears an outstanding
amount. Stripe requires `STRIPE_PUBLISHABLE_KEY` only for sites with an offer that opts into
incremental usage; ordinary Stripe checkout does not need it.

The adapter rejects tax and tax-ID collection, adjustable quantities, and shipping collection before
creating a payment. PlatformKit owns the offer catalog and does not create Hyperswitch products or
prices. The local Hyperswitch runner is a V2 API smoke test: it creates a customer, optionally creates a
payment-method session, creates an unpaid checkout intent, and retrieves its status. It does not
submit card data, authorize a payment, or issue a refund. Passing this smoke test does not verify
Stripe card acceptance or browser checkout. The previous API-only runner that posted raw card data
has been removed. A successful Stripe payment, V2 status retrieval, and refund remain
unverified. The V2 health endpoint confirms that the Router is running; it does not confirm that
the Card Vault and its JWE keys are configured. Run the Hyperswitch Card Vault (its `/api/v2/vault`
routes), set `locker.host` to it, and use one RSA key pair for the Router's `jwekey` and the vault's
`locker_private_key`/tenant `public_key`, with the vault tenant named `public`, before testing
payment-method sessions.

As of 2026-10-16, the published SDK's payment-method code is named for V2 but addresses
`/v1/payment-method-sessions/...`, which a V2 Router serves when its payment-method prefix is `v1`.
V2 intent creation returns a `cs_...` client secret. Enabling `payment_link_enabled` on V2 intent
creation does not return a hosted checkout URL, and V2 create-and-confirm requires payment-method
data. Neither path is a card-free hosted-checkout fallback.

The separate Hyperswitch Vault/Payment Methods SDK flow uses payment-method sessions and payment
tokens; it is not the same integration as Prism's Stripe.js connector-token flow. In the V1 Router
API, `payment_token` is a Hyperswitch vault reference, not a Stripe `pm_...` ID, and the Stripe
connector does not implement the hosted `PaymentSession` operation. Do not substitute a Stripe.js
token or assume a hosted Stripe Checkout fallback for this Router flow.

The repository includes an opt-in Docker Compose override that builds
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

An incremental usage charge's recovery has its own run against Stripe test mode, with the same
private file:

```sh
node packages/kit/build/stripe-usage-recovery.integration.mjs /path/to/private-stripe-test.env
```

It charges a saved card off-session the way the settlement does. A card that needs 3-D Secure comes
back as action required with the client secret the usage page uses, and a retry under the same
idempotency key returns the same PaymentIntent rather than a second charge. The customer's
verification is played on Stripe's test 3-D Secure page in a headless Chromium
(`stripe-3ds-complete.mjs`; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when Playwright's own build is not
installed), after which retrieval reports the charge paid. A card that saves but declines when
charged is a declined attempt, its key does not charge again, and the retry under a new key with
another card succeeds once. Every charge is refunded and the customer deleted. The verification here
confirms the PaymentIntent server-side; on the usage page Stripe.js does that step with
`STRIPE_PUBLISHABLE_KEY`.

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
verified. Complete those checks before using it for production sales. Hyperswitch's documented V2
API does not include connected-account payout operations, so the built-in adapter does not expose
`payouts.connected-accounts`; configuring a payout connector or saved payment method does not make
that capability available.

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

Set `HYPERSWITCH_BASE_URL`, `HYPERSWITCH_API_KEY`, `HYPERSWITCH_PROFILE_ID`,
`HYPERSWITCH_PUBLISHABLE_KEY`, and `HYPERSWITCH_WEBHOOK_SECRET` in the server environment. The API
key and webhook signing key never enter browser assets. The publishable key, payment client secret,
payment-method session authorization, and session ID are returned only for the checkout tab.
`HYPERSWITCH_CLIENT_URL` is optional; the default is Hyperswitch's hosted V2 SDK base. A custom URL
must end in `/v2` (or be a loopback URL for local development), and the browser loads
`HyperLoader.js` from it directly. The webhook secret is the profile's
`payment_response_hash_key`. Do not set Stripe credentials for a Hyperswitch site. The adapter
authenticates the raw webhook body before normalizing events. Checkout is a focused, branded page
with an order summary and provider-controlled secure card fields; invalid or expired links provide
a clear return to the store.

The official Web SDK loader still contains V1 payment-method-session paths, and the Token-Led guide
documents V1 payment confirmation. PlatformKit uses the SDK only for provider-controlled card
entry and V2 session confirmation; it then sends the returned Hyperswitch session token to V2
`confirm-intent` with a scoped publishable key and client secret. This keeps card data out of
PlatformKit and avoids the V1 payment-confirm helper. The V2 session-token flow is wired but has
not yet passed a real browser payment and issuer-authentication test. A successful paid-status
retrieval and refund are also unverified. Do not treat unit tests, the SDK asset check, or the
card-free Router smoke test as proof of a successful payment. The configured Stripe connector must
be verified as test mode before any paid test. See the
[Token-Led Payment guide](https://docs.hyperswitch.io/integration-guide/payment-suite/payment-method-card/payments.md),
[V2 payment-method-session confirmation](https://api-reference.hyperswitch.io/v2/payment-method-session/payment-method-session--confirm-a-payment-method-session),
[V2 payment confirmation](https://api-reference.hyperswitch.io/v2/payments/payments--confirm-intent), and the
[official Web SDK session helper](https://github.com/juspay/hyperswitch-web/blob/b7ee7e48bf1e55036ffaa3bad313aab8a9df2ab7/src/Utilities/PaymentHelpersV2.res).

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
