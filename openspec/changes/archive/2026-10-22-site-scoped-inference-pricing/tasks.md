# Tasks

## 1. Site inference configuration

- [x] 1.1 Add validated site-level provider definitions, ordered fallback behavior, model tariffs, usage-operation policies, and site/offer/operation markup precedence; verify with `packages/kit/build/inference-config.test.mjs` fixtures for independent free, prepaid, metered, override, incomplete, and conflicting declarations.
- [x] 1.2 Emit each site's non-secret inference and operation policies only to its server-side function runtime and exclude them from public site modules and catalogs; verify with `packages/kit/build/inference-config.test.mjs`, `packages/kit/build/assemble.mjs --check`, and an assembled-output secret/config leakage assertion.
- [x] 1.3 Add deploy validation that refuses enabled billable models without complete tariffs, valid secret references, and bounded fallback chains; verify with `packages/kit/build/deploy-checks.mjs --test`.

## 2. Provider selection and cost measurement

- [x] 2.1 Resolve providers, protocol adapters, model identifiers, and fallback order from the owning site's server configuration, preserving the actual provider/model for every attempt; verify with `packages/kit/build/inference-config.test.mjs` and fallback fixtures in `packages/kit/build/usage.test.mjs`.
- [x] 2.2 Normalize supported provider usage dimensions and calculate upstream cost only from the owning site's provider/model tariff; reject unknown or incomplete billable tariffs and never trust unvalidated response dollar amounts; verify with valid, absent, malformed, unsupported-dimension, and same-model/different-provider cases in `packages/kit/build/inference-config.test.mjs` and `packages/kit/build/usage.test.mjs`.

## 3. Reservation, settlement, and reporting

- [x] 3.1 Resolve a trusted operation policy before provider work: record site-funded calls without reader debits, and reserve sufficient reader authorization for every provider attempt permitted by a paid operation's fallback chain; verify free/paid operation isolation and zero provider calls on insufficient authorization in `packages/kit/build/usage-db.test.mjs`.
- [x] 3.2 Extend the declared usage ledger to retain per-operation and per-attempt provider/model, measured dimensions, provider cost, sponsor/offer, applied markup, and measured-versus-estimated status; verify declaration, RPC, idempotency, and row-policy behavior with `packages/kit/build/usage-db.test.mjs` and `packages/kit/build/assemble.mjs --check`.
- [x] 3.3 Settle measured attempts, conservatively settle possibly processed attempts with missing usage at no more than their reserved maximum, release attempts proven not sent, and release unused authorization; verify these paths and fallback counters in `packages/kit/build/usage.test.mjs` and `packages/kit/build/usage-db.test.mjs`.
- [x] 3.4 Keep provider cost, markup, customer units, and retail value distinct in administrator usage reporting, including a visible estimate indicator; verify the report with its focused test and rendered screenshots in both themes at 1280px and 390px.

## 4. Documentation and integration verification

- [x] 4.1 Update `sites/docs/content/docs/building-a-site/configuration.md` and `sites/docs/content/docs/running-a-site/selling/usage-billing.md` with the site provider declaration, secret references, tariffs, markup defaults/overrides, fallback reservations, and estimated-usage policy; verify with `packages/kit/build/docs-check.mjs`.
- [x] 4.2 Run the focused configuration, usage, deployment, and assembly checks, then validate the change and applicable cross-cutting specifications with `openspec validate site-scoped-inference-pricing --strict` and `openspec validate --all --strict`; report every scenario as passed, failed, or not verified, including any database or visual check that cannot safely run.
