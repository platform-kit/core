# Design

## Context

See [proposal.md](./proposal.md). Payment operations run in Deno Supabase Edge Functions. Supabase documents per-function npm dependencies, but Prism's published JavaScript SDK is explicitly Node.js-only and uses Koffi native `.node` bindings. The Prism Rust SDK documents request and response handlers that can be separated from its HTTP client; this provides an Edge-resident route without an external process.

## Goals / Non-Goals

**Goals:**

- Keep all Prism execution, connector transformation, and payment orchestration inside Supabase Edge Functions.
- Keep Stripe as the unchanged default path and preserve the provider-neutral ledger.
- Keep connector credentials and offer prices server-side, with explicit capability checks before side effects.
- Preserve historical payment data while removing Hyperswitch from new payment execution.

**Non-Goals:**

- Run a Node service, sidecar, container, remote Prism gRPC server, or any other payment process outside Supabase Edge Functions.
- Replace Prism's connector mapping with hand-written connector-specific HTTP implementations.
- Reimplement Stripe Billing features that Prism and a connector do not support.
- Collect raw card or bank details in PlatformKit or automatically migrate Hyperswitch tokens.
- Add processor routing, failover, or retry policy.

## Decisions

### Execute Prism inside the Edge Function

Use the Prism Rust request/response transformation handlers compiled to WebAssembly and loaded by the Deno Edge Function. The Edge Function validates and builds the Prism request, uses its native `fetch` to send the generated method, URL, headers, and body directly to the selected processor, then passes the response back through Prism's normalizer. This preserves Prism's connector-specific mapping; `fetch` is only the network transport, not a replacement implementation of processor APIs.

Do not import the Node SDK's Koffi `.node` binding or start another process. The published package documents Node.js 18+ and native FFI, while Supabase documents npm imports but does not guarantee this native addon in hosted Edge Functions. Do not use Prism's remote gRPC server because that would violate the Edge-only requirement.

The first implementation task must prove the Rust handler subset builds for `wasm32-unknown-unknown`, is loadable by the supported Deno Edge runtime, and stays within the function bundle/resource limits. Keep network I/O, secrets, webhook handling, request idempotency, and database writes in Deno. If the upstream Rust handler subset requires adaptation, add only the minimal WASM boundary needed to call Prism's handlers; do not fork or hand-reimplement connector mappings.

### Keep provider choice and capabilities explicit

`payments.provider` remains `stripe` by default for existing sites; Prism selection includes a connector identifier and server-side connector configuration. A checked-in capability declaration per supported connector is the source of truth for preflight. Do not trust a site's declared capabilities or infer support from a connector name. Adding an unverified connector requires adding and testing its declaration, but not writing another provider-specific payment adapter.

The Prism integration initially supports only operations whose request, response, webhook, and idempotency behavior are verified for that connector. Subscription, tax, catalog, portal, and payout capabilities remain absent unless the connector has a complete tested flow. In particular, Prism mandates alone do not imply a Stripe subscription object, schedule, proration, or portal.

### Preserve data ownership and payment safety

Markdown offers remain authoritative for product identity, amount, currency, and entitlements. The Deno function validates those values before constructing the Prism operation; no browser-supplied amount or entitlement reaches the connector. Only hosted or redirect checkout is enabled unless a separate safe payment-entry flow is fully specified. Edge Function environment secrets hold connector credentials and webhook keys; neither content nor browser responses contain them.

Every create/charge/transfer request carries a stable idempotency key derived from the platform operation. Do not blindly retry non-idempotent actions after a timeout; reconcile ambiguous outcomes through verified webhooks or an explicit provider lookup. Never log credentials, raw card/bank values, or full sensitive request bodies.

### Verify and normalize webhooks before ledger writes

The Prism webhook Edge Function retains the original body and verifies the selected connector's documented signature or secret before normalization, deduplication, and ledger processing. A connector without a supported verification path is unavailable for webhook-driven state. The shared durable inbox and ledger remain the authorities for event identity and payment effects.

### Retire Hyperswitch without destroying history

Remove built-in selection, API calls, checkout UI, renewal scheduling, and provider-specific schema behavior. Preserve historical payment, ledger, and reference rows; do not reinterpret Hyperswitch identifiers as Stripe or Prism identifiers. Stop all Hyperswitch renewal jobs. Existing recurring agreements and payment tokens cannot be ported automatically, so migration documentation must direct site owners to handle existing customers with their current processor.

### Keep the buyer flow hosted and minimal

Remove the Hyperswitch-specific checkout page and use the existing provider checkout redirect contract. No new card-entry controls, bank-entry forms, animations, or motion are introduced. The unchanged Stripe checkout remains the visual and behavioral baseline; verify redirect and error states at desktop and mobile sizes.

## Risks / Trade-offs

- [Prism's Rust transformation subset may not compile to WASM or may exceed Supabase limits] → Prove target compilation, Edge loading, bundle size, and representative transformations before building the adapter; keep only required handlers in the WASM artifact.
- [Supabase Edge Runtime may differ from local Deno for WASM or npm behavior] → Test the actual function bundle/runtime path; do not treat plain Node or Deno CLI success as sufficient.
- [A connector has incomplete or misleading feature support] → Maintain verified capability declarations and fail before side effects when a requirement is absent.
- [Processor timeouts can leave outcomes ambiguous] → Use idempotency keys, avoid blind retries, and reconcile from verified events or provider lookups.
- [A site has active Hyperswitch recurring customers] → Stop automatic renewals without migrating tokens, preserve records, and document the required processor-side manual transition before rollout.
- [Connector configuration contains secret material] → Keep it in Supabase function secrets, redact logs and errors, and test that no browser response or log includes it.

## Migration Plan

1. Prove and bundle the Prism Rust transformation handlers as WASM inside the Edge Function deployment artifact; no external service is provisioned.
2. Implement the Deno adapter, connector capability checks, webhook verification, and direct processor transport while Stripe remains the default.
3. Run focused WASM, Edge Function, capability, webhook, ledger, deployment, and Stripe regression tests without starting the full Supabase stack.
4. Remove Hyperswitch code and disable its scheduled jobs without dropping historical payment data. Do not archive the unfinished Hyperswitch delta as implemented.
5. Update configuration and environment documentation. Sites with active Hyperswitch recurring agreements must arrange manual transition with their processor.

Rollback restores the previous application and database migration bundle together. Do not reuse Prism credentials or references as Hyperswitch credentials.
