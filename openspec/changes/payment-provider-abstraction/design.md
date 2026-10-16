# Design

## Context

See [proposal.md](./proposal.md). Stripe currently enters shared workflows through `_shared/lib.ts` and is called directly by checkout, portal, confirmation, catalog push, webhook reconciliation, usage reporting, and payout code. Payment records also carry Stripe-shaped references. Site offers and the local order/entitlement ledger are already the source of truth for what is sold and what access is granted. The existing site module extension model can contribute server functions, routes, build steps, and environment requirements without changes to the kit.

## Goals / Non-Goals

**Goals:**
- Keep the site's offer catalog and ledger as the authority; isolate provider protocol, SDK, webhook, and identifier details.
- Make the existing Stripe feature set the first adapter, preserving configured Stripe sites.
- Let a site implement, register, configure, and deploy its own payment adapter through site-owned module code.
- Make unavailable capabilities explicit and safely reject unsupported behavior.

**Non-Goals:**
- Ship any non-Stripe adapter in this change; sites implement and own their adapters.
- Route different products through different processors, fail over between providers, or operate multiple active payment providers on one site.
- Automatically move live customers, payment methods, subscriptions, or balances between processors.
- Normalize away meaningful provider-specific tax, checkout, or marketplace behavior.

## Decisions

### Provider adapter owns external protocols; PlatformKit owns commerce decisions

Define a typed provider contract in the server-side payment boundary for provider metadata/capabilities, customer and hosted checkout operations, subscription changes and portal sessions, provider catalog synchronization where available, refunds, usage reporting and top-ups, connected-account onboarding and readiness, payouts, and webhook verification/normalization. Shared workflows consume normalized payment, checkout, subscription, refund, and usage events and continue to decide which offer was bought, what is recorded, and what entitlement follows.

Keep Stripe SDK imports and Stripe request/response shapes inside the Stripe adapter. Implement explicit operations rather than exposing a generic SDK client or arbitrary provider API passthrough; otherwise the supposed abstraction would still require every workflow to know Stripe's object model.

### Site modules register site-owned adapters

Expose the provider contract as a supported server-side extension API. A site-owned module registers a complete adapter with a stable id, implementation for every provider operation it uses, capability declaration, server-only factory, required secrets, and webhook handling. The assembled site resolves the configured provider only from Stripe or adapters registered by enabled site-owned modules; unknown ids fail configuration validation. Build and deploy assembly include the module's adapter code, webhook route, and declared environment needs using the same ownership checks as other site module assets. This uses the existing module extension model instead of inventing a separate plugin loader or requiring kit source edits.

Treat registered adapter code as trusted site-owned server code. Do not load adapter code dynamically from a network URL, expose secret configuration to the client, or let adapters bypass shared offer validation, provider-scoped identifiers, signature verification, idempotency, or ledger ownership.

### Capabilities are declared and checked before side effects

An adapter advertises which optional operations and terms it can honor. Shared checkout validation compares the actual cart and offer requirements with those capabilities before creating a provider session. Missing features produce a clear refusal; they are not silently dropped. Provider-specific features such as Connect payouts remain optional adapter capabilities, not mandatory members every provider must emulate.

### One provider per site; Stripe is the compatibility default

Resolve the provider from `payments.provider` in site-owned configuration, restricted to Stripe or an adapter registered by an enabled site-owned module, and keep credentials in deployment secrets declared by the owning module. If omitted, select Stripe to preserve existing sites and `STRIPE_*` deployments. Do not implement implicit fallback: it can create duplicate customers, mismatched subscriptions, or duplicate charges when the first provider's outcome is uncertain.

### Normalize external references and migrate without changing ledger meaning

Use provider-scoped references for remote objects and webhook event identities; migrate/backfill existing Stripe IDs as belonging to Stripe. Preserve read compatibility during rollout, then route all writes through provider-neutral references. Keep any legacy Stripe columns or webhook route needed for rolling deployments until the new path has been verified; do not delete or rewrite Stripe history.

Persist object references in `payment_provider_refs`, keyed by provider, object type, external ID, and the local entity they identify. A provider object may link to multiple local records, such as one checkout linked to its order and purchase rows. Persist webhook idempotency separately in `payment_events`, keyed by provider and event ID; keep `stripe_events` for compatibility until the webhook migration is verified.

For local commerce idempotency, derive a stable checkout identity from the selected provider and its external checkout ID. Stripe keeps its existing raw ID as that identity; other providers use a provider-prefixed identity. Store that identity in generic checkout fields and use it for purchase, order, booking, fulfillment, and entitlement joins. Keep Stripe-named columns populated only for Stripe, and backfill generic identities from those columns without rewriting existing Stripe rows.

### Webhooks normalize only after verification

The selected provider adapter verifies the raw request with its own configured secret before translating provider events to the internal event contract. The existing Stripe webhook URL remains valid. Event identity includes provider identity, and replay of the same provider event must remain idempotent. Do not infer payment success from a browser redirect or checkout return.

### Catalog synchronization is optional

The site's offer definitions remain authoritative. Adapters that require mirrored provider catalog objects synchronize them; providers that manage products externally may declare catalog synchronization unavailable/not required. The abstraction must not force all providers to share Stripe's product/price lifecycle or lookup-key semantics.

### The compiled Markdown catalog remains authoritative

Keep `content/store/products/*.md` as the declaration, `catalog.json` as the compiled offer representation, and provider push steps as derived synchronization. Preserve the current Stripe push. A site-owned adapter that requires mirrored provider catalog objects implements synchronization through the contract; a provider that does not require them can declare synchronization unavailable. Use stable offer keys to make pushes repeatable and update matching records rather than creating duplicate sellable offers.

### The adapter boundary covers processor calls, not shared commerce decisions

Every Stripe-specific request and response stays behind the Stripe adapter. The public contract has explicit operations for customer and checkout creation, subscription changes, portal sessions, catalog synchronization, refunds, usage reporting and top-ups, connected-account onboarding and readiness, payouts, and webhook verification and normalization. A site-owned adapter implements each operation its enabled features require; it does not get a generic Stripe client or an arbitrary API passthrough.

Validate each selected adapter at registration and operation time. A capability without its corresponding implementation is invalid; an operation requiring an undeclared capability fails before any provider-side effect. PlatformKit retains the shared offer validation, order/subscription ledger, entitlement rules, and event idempotency so a site adapter changes the provider protocol, not the meaning of a purchase.

## Risks / Trade-offs

- [Provider APIs do not share feature parity] → Require explicit capabilities and test unsupported operations fail before side effects.
- [A site adapter can claim a capability without implementing it correctly] → Validate declared operations against the contract and exercise all capabilities through shared conformance tests before enabling the adapter.
- [A site adapter can mishandle privileged credentials or event authenticity] → Run adapters server-side only, require declared secrets and explicit webhook verification, and test the shared contract with a site-owned fixture.
- [A broad interface could become Stripe's API renamed] → Keep contracts in site/business language and normalize only the values shared workflows need.
- [Backfilling references may misattribute or duplicate financial history] → Make the migration deterministic and idempotent, preserve original IDs, and test against populated data before deployment.
- [An unclear provider outcome can cause duplicate charges] → Keep stable idempotency identities in the adapter contract; never retry a non-idempotent operation without provider-supported idempotency or reconciliation.
- [Existing sites deploy old and new function versions during rollout] → Preserve Stripe secret names and webhook handling until new code is deployed and verified.

## Migration Plan

1. Publish the provider contract and site module registration API; register Stripe through it as the compatibility default, keeping existing Stripe environment values working.
2. Add/backfill provider identity for existing Stripe external references and event idempotency without changing ledger rows or entitlements.
3. Move Stripe workflows behind its adapter and verify them, including the existing Markdown-to-Stripe catalog push.
4. Verify the published adapter contract with a site-owned mock implementing the provider operations and exercising capability rejection, normalized webhook handling, and provider-scoped references.
5. Deploy the migration and compatible functions; verify Stripe checkout, webhook reconciliation, usage reporting, and payouts before removing any legacy write path.
6. Roll back by selecting Stripe and retaining legacy reference reads. Do not roll back a schema change by deleting provider-neutral fields or reassigning existing references.

## Open Questions

None. A site's adapter and provider credentials remain owned by that site and are not shipped or configured by PlatformKit.
