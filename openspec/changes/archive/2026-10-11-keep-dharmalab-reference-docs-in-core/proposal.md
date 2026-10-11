# Proposal

## Why

The public Core repository needs an accessible account of PlatformKit's purpose and the capabilities it actually provides. The missing files were DharmaLab product documents, not a Core feature inventory; copying them unchanged would put the wrong product description in Core and violate its current ownership boundary.

## What Changes

- Write Core-specific `docs/PURPOSE.md` and `docs/FEATURES.md` in plain language, grounded in Core's active specifications, modules, generic fixtures, and supported workflows; do not copy DharmaLab-only claims or present optional/site-registered capabilities as universally enabled.
- Keep the boundary strict: the new Core documents must remain site-neutral, and the boundary test must continue rejecting downstream identity and content.
- Audit separation completeness across public Core contents, the separate site checkout, feature/spec coverage, and runnable Core/source-CLI checks. Report each verified path and any unverified integration; do not run a production deployment or claim proof of no possible mistakes.

No runtime behavior or interface copy changes are proposed. The two new documents are the complete proposed reader-facing copy and will be reviewed before implementation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kit-principles`: require accurate, site-neutral purpose and feature documents in Core, distinguishing generic capabilities from site-configured, optional, or fixture-only behavior.

## Impact

The Core purpose/features documents and `kit-principles` are affected. Verification covers the site-boundary and docs guards, the Core test suite's relevant selectors, source CLI/deploy regression tests, and an explicit cross-check of every feature claim against its spec and an implementation/test signal.
