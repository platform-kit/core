# Tasks

## 1. Usage offers and Stripe metering

- [x] 1.1 Extend the product declaration, Velite schema, and compiled catalog with the optional
      usage-unit, rate, grant, included-allowance, meter, and overage-price fields; preserve the
      existing compiled shape for offers without `usage`. Verify with
      `node packages/kit/build/usage.test.mjs` and the targeted catalog checks.
- [x] 1.2 Reconcile a fixed/base Stripe price and a metered Stripe price for usage offers, create
      the sum meter idempotently, require a unique meter event name and one currency per offer,
      and keep legacy offers on the current one-price path. Verify with the Stripe mock tests in
      `packages/kit/build/usage.test.mjs`, including replay and byte-for-byte legacy catalog
      assertions.
- [x] 1.3 Add metered Checkout line items and invoice-period included grants; report only
      overage units to Stripe with stable meter-event identifiers, retrying uncertain events
      only inside Stripe's documented identifier-uniqueness window. Verify with mocked checkout,
      webhook replay, and meter-event sum/retry assertions in `packages/kit/build/usage.test.mjs`.
- [x] 1.4 Make deploy checks require the live Stripe credentials and meter configuration only
      when a published offer declares metering. Verify with the targeted deploy-check fixtures
      and `node packages/kit/build/deploy-checks.mjs --test`.
- [x] 1.5 Add the site-level automatic-top-up switch and eligible-pack declarations, then
      implement reader-consented off-session pack purchases through Stripe. Grant the pack only
      after confirmed payment, with stable payment idempotency. Verify site-disabled, declined,
      authentication-required, successful, and duplicate-payment cases in
      `packages/kit/build/usage.test.mjs`.

## 2. Usage records and balances

- [x] 2.1 Declare append-only `usage_events` and `usage_grants`, the derived balance view, the
      required reservation records, reader-owned automatic-top-up preferences, idempotent top-up
      attempts, indexes, and RLS in kit schema sources; retain the meter-report lifecycle needed
      to stop unresolved retries after the uniqueness window, and classify the tables as state.
      Verify with declaration checks and usage SQL tests.
- [x] 2.2 Add idempotent grant, authorize, reserve, settle, and release operations with fixed-point
      units and included-allowance accounting. Verify replay safety, derived balances, and
      reader isolation in `packages/kit/build/usage-db.test.mjs`.
- [x] 2.3 Expose a server-side usage API that any configured billable operation can call without
      bot or surface identity; derive the subject from verified auth and keep rates/costs
      server-owned. Verify a non-bot invocation fixture and refusal-before-provider behavior in
      `packages/kit/build/usage.test.mjs`.
- [x] 2.4 Prove simultaneous prepaid reservations cannot overspend and long-running work cannot
      cross its authorized maximum without another successful reservation. Verify with
      concurrent and bounded-stream cases in `packages/kit/build/usage-db.test.mjs`.
- [x] 2.5 Assemble generated Supabase files from their sources and verify `assemble --check`
      reports no drift; do not edit generated `supabase/` files directly.
- [x] 2.6 Make top-up preferences reader-owned and enforce the reader's personal calendar-month
      spend cap in the server-side admission path. Serialize concurrent attempts, grant confirmed
      payments once, and refuse provider work until the grant is visible. Verify cap boundaries,
      replay, concurrent attempts, and reader isolation in
      `packages/kit/build/usage-db.test.mjs` and `packages/kit/build/usage.test.mjs`.

## 3. Billing bots across surfaces

- [x] 3.1 Add the optional bot `billing` offer reference to the content model and compiled bots;
      an absent reference preserves current behavior. Verify the bot schema and catalog
      fixtures in `packages/kit/build/usage.test.mjs`.
- [x] 3.2 Route `agent_summon` and `copilot_turn` through the shared gate while preserving the
      spending ceiling as an additional limit; persist measured provider cost against the
      verified subject and stable offer identity. Verify free, prepaid, exhausted, active,
      expired, and over-ceiling cases in the focused usage tests.
- [x] 3.3 Verify that billed shared-channel, private-conversation, copilot, and speech work all
      use the same gate, and that denial makes no paid provider call. Focused agent, copilot,
      speech, and database tests passed. A disposable isolated Edge Runtime probe exercised a
      billed shared-space run and a private support conversation whose subject was resolved by
      `agent_subject`: zero-balance runs stopped with `usage_balance_exhausted`, no model step,
      no recorded spend, and no answer; a prepaid grant admitted scripted runs on both surfaces.
      The probe used only a dummy provider key and scripted responses, so it made no paid provider
      calls. `agents-db.test.mjs` passed 29 checks; its seed-dependent purchase/privacy and
      enrichment-job branches reported their documented skips.
- [x] 3.4 Demonstrate that a site operation with no bot association can use the same gate and
      cannot proceed without prepaid authorization or an active matching usage subscription.
      Verify the non-bot fixture and provider-call counter in `packages/kit/build/usage.test.mjs`.

## 4. Speech accounting

- [x] 4.1 Record browser STT seconds as zero-cost telemetry, and measure endpoint TTS seconds
      from server-observed PCM bytes through the shared gate; attach usage to the verified
      subject and stable offer, with bot as optional provenance. Verify endpoint stream
      authorization, accounting, interruption, fallback, and reconnection idempotency in
      `packages/kit/build/usage.test.mjs`.
- [x] 4.2 Compare one endpoint-backed spoken conversation's recorded model and TTS costs with
      the configured providers' own figures; report this as NOT VERIFIED if no suitable
      credentials are configured, rather than substituting a mock result. NOT VERIFIED — no
      suitable provider credentials are configured; no live call or mock substitute was used.

## 5. Reader and administrator surfaces

- [x] 5.1 Add a dedicated `/app/usage` page for the reader's balance, cross-operation usage
      history, and purchase-more route, independent of bots and conversations. Remove usage
      statistics from the voice conversation-history drawer while preserving its list, resume,
      and delete functions. Keep visible words in theme UI markdown and site overrides where
      needed. Verify string merge and balance behavior, then render and inspect both surfaces
      at desktop and mobile sizes in both looks.
- [x] 5.2 Add the admin's recent measured cost per unit beside the declared unit price, with
      an explicit below-cost warning that does not block saving, and surface unresolved meter
      events for reconciliation. Verify the data calculation and unresolved-event state with
      focused tests, then render and inspect the editor in both looks at desktop and mobile sizes.
- [x] 5.3 Add reader controls on `/app/usage` to opt in/out of automatic top-up, choose an
      eligible pack and low-balance threshold, set and change a personal monthly spend cap,
      and manage the required saved-payment consent. Explain failed or authentication-required
      payment without implying the paid operation ran. Verify preference isolation and strings,
      then render and inspect the changed states at desktop and mobile sizes in both looks.

## 6. Documentation and verification

- [x] 6.1 Update the canonical docs site with a guide to usage offers, prepaid and metered
      billing, site enablement and reader-controlled automatic top-up, the dedicated
      cross-operation `/app/usage` page, the surface-independent server gate, bot and speech
      consumers, and known boundaries; update offer, site-config, and bot reference pages, name
      their sources, and change page words rather than only review dates. Verify with
      `node packages/kit/build/docs-check.mjs`.
- [x] 6.2 Run the focused usage, catalog, declaration, database, and UI checks named above, validate
      OpenSpec with `npx openspec validate --all --strict`, and report each change scenario as
      passed, failed, or not verified plus applicable `design-rules`, `admin-editing`,
      `kit-principles`, `product-principles`, and `deploy` checks. Do not run the full workspace
      suite unless the user requests it.
