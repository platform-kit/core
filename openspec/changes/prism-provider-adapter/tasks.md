# Tasks

## 1. Establish the provider contract and Edge-resident Prism runtime

- [ ] 1.1 Archive the completed `payment-provider-abstraction` change to establish its shared `payment-providers` specification; verify `openspec list --specs` includes it and the archived delta matches the implemented contract.
- [ ] 1.2 Build a minimal WASM wrapper around Prism's Rust connector request/response handlers and prove it compiles for `wasm32-unknown-unknown`, loads in the supported Deno Edge runtime, and fits Supabase function bundle/resource limits; verify the Edge-runtime smoke test passes without starting the full Supabase stack or a separate process.
- [ ] 1.3 Implement Deno bindings that pass validated inputs into Prism's WASM handlers, send only Prism-generated connector requests with Edge `fetch`, and normalize responses through Prism; verify tests cover request/response transformations and assert no connector-specific mapping is hand-written in PlatformKit.
- [ ] 1.4 Add a verified capability declaration for each initially supported Prism connector and validate connector settings without trusting site-declared capabilities; verify `node packages/kit/build/payment-providers.test.mjs` covers supported, unsupported, and unknown connectors.

## 2. Integrate Prism with payment workflows

- [ ] 2.1 Register Prism and its server-only configuration in provider assembly, module validation, and deployment preflight while keeping Stripe as the default; verify `node packages/kit/build/payment-providers.test.mjs` and `node packages/kit/build/deploy-checks.mjs --test`.
- [ ] 2.2 Implement the Prism adapter for verified hosted checkout and other initially supported operations using the Edge-resident WASM bindings, checking capabilities before side effects; verify connector fixtures cover success, invalid responses, unsupported operations, and no fallback.
- [ ] 2.3 Connect Deno payment functions directly to the selected processor through Prism-generated requests using site-validated offer amounts, provider-scoped references, and stable idempotency keys; verify focused checkout tests reject client-supplied prices and require no gateway URL or Node process.
- [ ] 2.4 Implement Prism webhook verification inside the Edge Function against the original body and normalize only verified events into the existing durable inbox; verify offline webhook tests cover invalid signatures, replay, event deduplication, and zero writes on rejection.
- [ ] 2.5 Keep subscription, tax, catalog, portal, and payout features disabled unless a connector has a complete verified flow, including secure payout enrollment; verify capability tests prove unsupported operations make no provider request or ledger claim.

## 3. Retire the built-in Hyperswitch path safely

- [ ] 3.1 Remove Hyperswitch-only registry/configuration, adapter/API calls, billing branches, checkout-session client fields, and renewal function references while retaining the shared provider contract and Stripe adapter; verify `node packages/kit/build/payment-providers.test.mjs` and targeted Stripe checkout, ledger, usage, and payout tests.
- [ ] 3.2 Remove the Hyperswitch checkout route and page, provider-specific function, and obsolete tests/dependencies; verify route tests and render the generic checkout redirect and error states at mobile and desktop sizes in light and dark themes.
- [ ] 3.3 Add a forward migration that disables Hyperswitch renewal jobs and removes obsolete Hyperswitch-only routines without deleting or reinterpreting historical payment, ledger, or reference rows; verify an offline migration fixture retains historical rows and confirms no renewal job remains, without starting Supabase.
- [ ] 3.4 Update the unfinished `hyperswitch-provider-adapter` change as superseded and archive it without merging its delta into main specs; verify the archived record retains its incomplete task state and `openspec list --specs` contains no Hyperswitch requirement.

## 4. Document and verify the complete change

- [ ] 4.1 Update `sites/docs/content/docs/building-a-site/payment-providers.md`, `sites/docs/content/docs/reference/environment-variables.md`, `sites/docs/content/docs/building-a-site/configuration.md`, `sites/docs/content/docs/building-a-site/dev-build-and-deploy.md`, and any other page that still describes Hyperswitch; verify `node packages/kit/build/docs-check.mjs`.
- [ ] 4.2 Verify Prism and Stripe scenarios with the focused provider, webhook, checkout, ledger, deployment, Edge-runtime/WASM, and migration-fixture tests; exercise a live connector only when credentials are available, and report it as not verified rather than blocking completion if credentials are absent.
- [ ] 4.3 Inspect the rendered checkout redirect, unsupported-capability error, and failure state at mobile and desktop sizes in light and dark themes; record the inspected states and viewport sizes.
- [ ] 4.4 Run the final relevant OpenSpec and documentation checks, then report every Prism, deployment, webhook, and retirement scenario as passed, failed, or not verified with the reason; verify native Stripe regression tests remain green.
