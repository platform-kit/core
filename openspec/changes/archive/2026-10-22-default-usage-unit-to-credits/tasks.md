# Tasks

## 1. Default usage units

- [x] 1.1 Add a shared resolver that prefers the configured offer unit, then a recorded event unit, then `credits`; cover explicit, blank, and missing values with `usage-unit.test.mjs`.
- [x] 1.2 Normalize omitted or blank `usage.unit` to `credits` in catalog compilation and verify explicit units and defaults with `usage.test.mjs`.
- [x] 1.3 Allow metered offers without an explicit unit in deployment validation, while retaining rate, meter, and overage checks; verify with `node packages/kit/build/deploy-checks.mjs --test`.

## 2. Usage labels and documentation

- [x] 2.1 Use the shared resolver for Usage balances, activity, pack sizes, and top-up thresholds; verify unit precedence and default labels with `node --test packages/kit/build/usage-unit.test.mjs`.
- [x] 2.2 Update `sites/docs/content/docs/running-a-site/selling/usage-billing.md` to document the optional unit and the per-credit rate default; verify with `node packages/kit/build/docs-check.mjs`.

## 3. Validate the change

- [x] 3.1 Run focused usage and deploy tests and verify configured-unit precedence, recorded-unit fallback, and the credits default.
- [x] 3.2 Validate the change and main specs with `openspec validate default-usage-unit-to-credits --type change` and `openspec validate --specs`.
