# Tasks

## 1. Audit Core capabilities and the repository split

- [x] 1.1 Inventory Core's active capability specs, module declarations/manifests, generic sites, and named tests; build an evidence map for each proposed feature claim and label configured, optional, fixture-only, and unverified behavior. Verify every claim has a spec plus implementation or test signal before it enters `docs/FEATURES.md`.
- [x] 1.2 Compare the public Core tree and refs with the site repository's tracked tree and the separation contract; identify missing Core-owned packages, docs, configuration, tests, generated artifacts, or accidental site-owned material. Verify by recording the exact commits/refs and a reviewed ownership checklist; do not modify the site checkout.
- [x] 1.3 Trace the independent site's dependency and command setup against the Core-source CLI path, including its manifest/lockfile and source receipt checks. Verify with focused source CLI and deploy-preflight tests; do not execute production-facing deploy steps.

## 2. Write and enforce Core's purpose and feature inventory

- [x] 2.1 Write `docs/PURPOSE.md` in accessible, site-neutral language from `kit-principles`; verify it makes claims only about PlatformKit and its intended users.
- [x] 2.2 Write `docs/FEATURES.md` from the evidence map, in user-facing rather than implementation terms, with availability caveats wherever a site must enable, register, publish, or configure a capability; verify every section maps to the audited evidence.
- [x] 2.3 Update `packages/kit/build/site-boundary.test.mjs` so both documents are maintained and scanned, while any downstream-site identity or product material still fails; verify with the boundary test and a temporary sentinel check that is cleaned up.
- [x] 2.4 Run the Core docs guard and strict OpenSpec validation; verify both new documents are included in maintained Core coverage and no stale docs are reported.

## 3. Verify and report the result

- [x] 3.1 Run the focused Core source CLI, deploy receipt/preflight, workspace, and boundary tests relevant to repository separation; verify each result against the exact checked-out commit and record pass/fail/not-verified.
- [x] 3.2 Run the Core build or targeted test selectors necessary to check the feature claims without invoking destructive database operations, live email, paid generation, or production deployment; verify each claim's supporting test and explicitly list anything not exercised.
- [x] 3.3 Report the repository audit, the evidence behind the Core feature inventory, all check outcomes, and concrete omissions or remaining uncertainty; verify no production deploy or remote push occurred during the audit.
