# Design

## Context

See [proposal.md](./proposal.md) for motivation and scope. PlatformKit currently selects one payment-provider adapter per site, defaults to Stripe, and checks that an adapter implements the methods for its declared capabilities. The normalized contract has 18 capabilities spanning checkout, subscriptions, customers, catalog synchronization, refunds, usage billing, and connected-account payouts.

Hyperswitch exposes a unified API over configured processor connectors and payment services. Its V2 API uses a server-side API key and merchant profile; connector credentials and routing are configured in Hyperswitch. The current adapter mixes V1 and V2 routes and includes V1 fallbacks. The checked V2 API reference documents intent, customer, payment-method-session, saved-method, and refund operations, but no V2 payout operation. The local V2 test stack also needs a seeded merchant/profile and valid Vault configuration before it can verify a Stripe browser payment. Outgoing webhooks are signed with HMAC-SHA512 using the profile's `payment_response_hash_key`; deliveries can be retried.

## Goals / Non-Goals

**Goals:**

- Add Hyperswitch as a built-in provider while preserving Stripe as the default.
- Map every documented V2-supported Hyperswitch capability to normalized PlatformKit results, and do not advertise V1-only operations.
- Let Hyperswitch own connector selection and routing; PlatformKit remains unaware of direct processor credentials.
- Keep provider credentials server-side and preserve shared ledger, idempotency, and provider-scoped references.
- Make each site's configured Hyperswitch profile's usable capabilities explicit enough to validate enabled site features before payment side effects.
- Keep the PlatformKit-owned buyer journey materially consistent with Stripe outside the provider-controlled payment-entry step.

**Non-Goals:**

- Deploy, host, or provision Hyperswitch or the site's processor accounts.
- Add separate built-in adapters for each processor behind Hyperswitch.
- Migrate existing Stripe customers, subscriptions, or balances automatically.
- Redesign site merchandising or change PlatformKit's offer, entitlement, or ledger authority. Preserve Stripe's existing checkout behavior; make only the shared checkout and billing-surface changes needed for provider continuity.
- Force provider-controlled payment forms, redirects, wallets, branding, or authentication flows to look identical.
- Keep Hyperswitch V1 compatibility or a V1 fallback in the adapter. Do not expose connected-account payouts until a documented V2 payout API exists.

## Decisions

### Keep Hyperswitch as one PlatformKit provider

Register Hyperswitch alongside Stripe as a built-in provider and select it with the existing single-provider setting. Every operation goes through Hyperswitch's unified API; configured processors, payment methods, routing, retries, and related services remain Hyperswitch concerns. This avoids reproducing a connector matrix in PlatformKit and avoids exposing processor credentials to its runtime.

**Alternative considered:** add a direct PlatformKit adapter per processor. This duplicates the abstraction Hyperswitch provides and makes each site choose and maintain a processor-specific integration.

### Use V2 Router APIs exclusively

Use the documented V2 routes for payment-intent creation/confirmation/retrieval and refunds. Customer creation, payment-method sessions, and saved methods belong to the V2 Router's payment-method service group, which the Router serves under the prefix set by `payment_methods_prefix` (`v2` on a stock Router). Hyperswitch's Vault SDK guide creates the session at `/v1/payment-method-sessions` and the Web SDK addresses the same path, so the adapter defaults to `v1` (`HYPERSWITCH_PAYMENT_METHODS_PREFIX`) and the Router is configured with `payment_methods_prefix = "v1"` to match. Remove fallbacks: a 404 or unsupported operation is an explicit failure, never a reason to retry against a different API version. The Web SDK asset URL is configured separately; a `/v1` path in a hosted SDK URL does not authorize a V1 Router API call. A payment token from a volatile session lives only in Redis and cannot be confirmed by `confirm-intent`, so checkout sessions using the SDK's card fields are persistent and require a Card Vault.

The V2 API reference checked for this change has no payout endpoint. Do not keep the V1 payout route or advertise `payouts.connected-accounts` for Hyperswitch until a documented V2 operation is available.

**Alternative considered:** retain V1 compatibility for missing V2 operations. This would violate the V2-only requirement and allow the same site to issue payment operations through different API contracts.

### Implement the full normalized contract across Hyperswitch and PlatformKit

Preserve the normalized PlatformKit behavior for operations supported by documented V2 APIs without claiming that Hyperswitch has native APIs for every behavior. The Hyperswitch adapter handles V2 payment movement and documented provider operations. PlatformKit's existing commerce layer owns the site offer catalog, recurring billing state, usage accounting, and customer self-service where Hyperswitch does not expose a documented equivalent. Any collection or refund still goes through the selected Hyperswitch provider; no direct processor integration or second payment provider is introduced. V1-only payouts are explicitly unavailable rather than silently routed through V1.

Because the Hyperswitch documentation does not describe a runtime API for aggregated profile capabilities, use a site-owned, profile-scoped capability declaration, verified against connector capability references and actual Hyperswitch configuration. Assembly/deployment checks compare the site's enabled commerce terms with that declaration; operation preflight rejects a provider-backed term not declared for the active profile before sending a request. PlatformKit-managed behavior is not represented as a Hyperswitch connector capability.

When multiple connectors are configured, the declaration covers the set of routes eligible for the relevant operation. Hyperswitch remains responsible for applying its routing rules. Do not infer support from one connector's capabilities or silently omit a requested term.

**Alternative considered:** assume every Hyperswitch profile supports every feature or route every billing behavior to undocumented Hyperswitch endpoints. The official docs describe connector-specific variation and do not document a profile-level capability query or all Stripe-equivalent billing APIs; either assumption could silently misrepresent the configured profile or rely on unsupported behavior.

### Keep PlatformKit's commerce records authoritative

Use Hyperswitch identifiers as external references only. Continue to derive products, prices, entitlements, and ledger transitions from PlatformKit's site content and shared commerce logic. PlatformKit-owned catalog synchronization remains an adapter-contract operation over those offers and must not pretend that a Hyperswitch product or price was created. Preserve idempotency keys when retrying payment operations, and scope external references and event ids by the `hyperswitch` provider identity.

**Alternative considered:** mirror Hyperswitch catalog data into PlatformKit as the source of truth. This would conflict with the existing offer-file workflow and make checkout results depend on an independently edited catalog.

### Keep recurring billing and customer self-service in the shared commerce layer

Use PlatformKit's shared billing records for subscription schedules, changes, and usage accounting unless the configured Hyperswitch service explicitly exposes the matching operation. Provide a PlatformKit-hosted customer billing surface for self-service actions not exposed by Hyperswitch, with those actions calling the selected provider-neutral commerce routes. Charge, refund, and payout requests continue through Hyperswitch. The built-in provider must not claim an operation is natively supported by a profile merely because PlatformKit can provide the corresponding site behavior.

**Alternative considered:** require an undocumented Hyperswitch customer portal or subscription lifecycle endpoint. Official documentation does not establish those APIs as a supported contract, so this would make a site depend on behavior it cannot verify.

### Settle optional usage increments through the selected provider

An offer may set `incremental_charge_minor` to collect each full threshold of metered usage in a separate off-session payment. PlatformKit snapshots the threshold and currency with each usage event, then the shared usage layer owns threshold calculation, settlement records, and idempotency; provider adapters only move the resulting payment. For opted-in events, do not also report the same usage to native provider metering. At period close, settle the remaining balance after subtracting successful incremental payments. Use the same PlatformKit-level result for Stripe and Hyperswitch, while keeping payment and failure handling provider-specific. These are captured charges, not increases to an open authorization.

**Alternative considered:** require each provider's native metering service to implement identical real-time billing. Hyperswitch does not expose a usage-event API, and Stripe's native meter settles through subscription invoicing rather than immediate threshold transactions.

### Use the documented Hyperswitch Web SDK for checkout confirmation

Create a V2 payment intent on the server with the amount and PlatformKit order metadata, then render a V2-compatible Hyperswitch Web SDK payment widget on the generic PlatformKit checkout route. Card data stays in provider-controlled secure fields and is never submitted through PlatformKit endpoints. The API key and webhook key remain server-only; only the publishable key and one intent's client authorization are returned to the browser. The checkout route offers a site-owned cancel link, and redirects remain untrusted until V2 retrieval or a verified webhook confirms the payment.

Do not use `payment_link: true`: the official payment-link API does not establish support for PlatformKit's required cancel behavior and checkout terms. Do not claim tax collection, per-checkout payment-method restrictions, adjustable quantities, or shipping collection until each is mapped to a documented Hyperswitch API/SDK field and covered by tests. Unsupported terms must be rejected before creating an intent. Hyperswitch's current Web integration guide documents its loader and widget confirmation flow; use that documented client boundary without adding a React-only dependency to the Vue theme.

### Verify webhooks before normalization

Read the original request bytes, validate `X-Webhook-Signature-512` with HMAC-SHA512 and the configured profile signing key using a constant-time comparison, then parse and normalize the event. Pass the Hyperswitch `event_id` through the shared idempotent event path. Reject invalid signatures without writes, and acknowledge duplicate deliveries without applying a transition twice. A browser return URL is never payment confirmation.

**Alternative considered:** trust parsed JSON, redirects, or connector-specific callbacks directly. Hyperswitch signs its outgoing webhook body and retries deliveries; the shared route must authenticate and deduplicate those deliveries.

### Use server-side configuration and the documented browser SDK

Configure the Hyperswitch instance URL, API key, profile id, publishable key, and webhook signing key through the server environment. The API key and signing key are secrets; none are copied into browser assets. The publishable key is intentionally returned only to the checkout page. Use the existing server runtime's HTTP capabilities for API requests and Hyperswitch's documented browser SDK for payment entry and confirmation.

**Alternative considered:** use hosted payment links alone. Their documented create flow does not establish the required PlatformKit cancel behavior and checkout terms; use the SDK client confirmation path instead.

### Verify the complete Stripe flow against V2 in a browser

Extend the isolated V2 test stack with a disposable merchant/profile, the Stripe test connector, and valid local Vault/JWE configuration. Keep connector credentials and test-only keys outside tracked files. Exercise the PlatformKit checkout page in a real browser, record that payment operations reach only V2 routes, verify that card fields are provider-controlled and no card data reaches PlatformKit, then retrieve and refund the resulting test payment through V2. A widget render, a V1 API call, or a direct API submission of card data does not satisfy this verification.

Language remains in the existing site-owned checkout content; the visible order summary, pay/cancel controls, and motion remain unchanged. PlatformKit continues to own orders and the commerce ledger, while Hyperswitch owns the payment and Vault records.

### Keep the customer journey consistent around the provider payment step

Treat the store-to-checkout transition, visible offer and order summary, checkout terms, cancellation, pending/error/success messaging, return destination, and billing self-service as PlatformKit-owned behavior. The Hyperswitch page uses the same site shell and editable shared UI copy as the Stripe journey and receives a normalized checkout snapshot so it can show the same item, amount, currency, and billing terms. Keep the current Stripe checkout flow unchanged. Allow Hyperswitch's payment widget, payment-method choices, branding, redirects, and required authentication or disclosures to differ; these are the provider-specific portion of the flow, not a reason to change the offer or post-payment experience. Normalize provider failures to site-owned messages rather than rendering raw vendor text.

**Alternative considered:** force Stripe and Hyperswitch to use one identical payment form. Their hosted and embedded payment surfaces have different capabilities and requirements; imposing a single form would either remove useful provider features or make one adapter emulate undocumented behavior.

## Risks / Trade-offs

- **Connector/profile configuration can drift from the site's declared capability set** → validate the declaration during assembly/deploy, document how to verify it against Hyperswitch's connector references, and include sandbox cases for each required capability and configured routing path.
- **Hyperswitch API or connector behavior changes** → isolate request/response translation in the adapter and keep contract tests for every capability and normalized event.
- **A V2 operation is absent or its local profile is incomplete** → do not fall back to V1; refuse unsupported capabilities and keep the V2 browser scenario unverified until the merchant/profile, connector, Vault keys, and Stripe test access are correctly configured.
- **Webhook retries and out-of-order events** → authenticate raw bytes, deduplicate by event identity, and preserve the shared commerce transition rules.
- **Changing providers does not migrate existing provider objects** → keep Stripe as the default, scope references by provider, and require an explicit site-owned migration plan before switching existing commerce records.
- **Provider SDKs expose different interaction and error states** → normalize states and customer-facing messages around the payment-entry step, retain provider-required redirects/authentication, and visually verify the shared journeys at relevant sizes and themes.

## Migration Plan

Keep Hyperswitch registration without changing the Stripe default. A site opts in by selecting Hyperswitch, configuring a V2 Router, server credentials, and business profile, and declaring only capabilities guaranteed by V2 and the profile's eligible routes. Do not automatically migrate historical V1 Hyperswitch objects; if V2 cannot resolve an existing reference, return an explicit error rather than calling V1. Rollback to Stripe applies only to new operations; provider-scoped records are not rewritten.

## Open Questions

None. The Hyperswitch profile capability declaration is the chosen preflight mechanism because the official documentation does not describe an aggregated runtime capability endpoint.
