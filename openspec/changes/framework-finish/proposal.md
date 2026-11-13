# Proposal

## Why

After `modules-as-packages`, PlatformKit is organised like a framework but not finished like one. The audit (`docs/AUDIT.md`) measured what is left:
- no version or upgrade discipline;
- a site configuration that is mostly untyped (25 sections are `Record<string, unknown>`);
- 6,544 `any`s;
- five files of 1,300–5,400 lines;
- 2,638 lines over 200 characters;
- 115 database calls made directly from page components;
- a home-made test harness in 143 tests;
- 11 spec scenarios with no test;
- no supported way for a site to change a business rule, react to an event or override a component without copying it.

This change closes every remaining audit item: full typing, conventional code, and a stable, upgradeable public interface.

## What Changes

- **Code standards, enforced:**
  - ESLint and Prettier across all code, formatted in one commit kept out of blame;
  - ratchets that fail a check when `any`s, oversized files, long lines or direct table access in page code increase.
- **One home for shared code:** code shared by the browser, the build and the functions is imported by one name in all three.
- **A data layer:** pages reach data only through their module's `lib/`.
- **The five oversized files split** along drawing, logic and data.
- **A typed site configuration:** every section has a schema, and a mistyped key fails with a suggestion. Modules contribute their own sections.
- **`any`s narrowed; the last JavaScript converted; tests moved to `node:test`.** Moved from `typescript-throughout`.
- **Content parity:** both content paths refuse the same invalid entries.
- **Site rules:** named, stable SQL hook functions through which a site adjusts prices, promotions, payouts and access without replacing kit functions.
- **One-off data changes,** run once per database and recorded.
- **Override contracts:** an override is checked against the original's props, slots and events, and the build warns when the original changes.
- **Kit events:** a typed event catalogue (order paid, member joined, course completed and others) that a module's server listener receives, with retries.
- **Releases:** one version for all packages through Changesets, an API report that fails a check when the public interface changes without a recorded change, and a version policy.
- **Spec coverage:** the 11 untested scenarios and two payout cases, and the wrong spec names fixed. Moved from `specify-every-module`.
- **Every test green and a full end-to-end run.**

## Non-goals

- Narrowing the feature set or reviewing each module against its category leader (audit item 19). That is a product decision.
- Unifying the four existing webhook mechanisms. Events deliver alongside them.
- Publishing to npm, deploying or pushing.

## Review focus

- The ratchet thresholds.
- Hook functions as the site-rule mechanism.
- The event catalogue's first entries.
- The version policy for 0.x.

## Affected specifications

New: `code-standards`, `site-config`, `site-rules`, `data-changes`, `kit-events`, `releases`.
Modified: `content-models` (parity), `theme-contract` (override contracts).

## Surfaces

`check`, `test`, `migrate` and `dev`; the build; every module; the admin save path; the docs site; `AGENTS.md`.
