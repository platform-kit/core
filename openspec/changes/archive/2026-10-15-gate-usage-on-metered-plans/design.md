# Design

## Context

See proposal.md for motivation and account-billing-usage/spec.md for the behavior contract. The Usage panel currently treats usage offers, reader data, settings, and read failures as eligibility signals. The product model distinguishes prepaid one-time packs from metered subscription offers; the Usage billing guide defines metered plans by a subscription offer with a usage meter.

The site's published product catalog owns plan availability. Usage balances, history, and top-up preferences belong to individual readers. No database migration is needed.

## Goals / Non-Goals

**Goals:**
- Make one catalog-level eligibility rule determine whether signed-in readers can access Usage.
- Show the same Usage availability for all signed-in readers on a site with a published metered plan.
- Keep the Usage panel and its private reads unavailable when the site has no published metered plan.
- Preserve existing membership, Usage empty/error states, provider flows, and the legacy `/app/usage` redirect.
- Present the page as “Billing” without an Account eyebrow or explanatory intro; keep sign-in copy route-specific and editable.

**Non-Goals:**
- Changing how metered plans or prepaid packs are sold or billed.
- Deleting, migrating, or exposing reader usage records when a site removes its metered plan.
- Changing downstream site catalogs or adding site-specific copy.
- Changing sign-in behavior, typography, or tab appearance.

## Decisions

1. **Use the published catalog as the sole eligibility source.** A qualifying offer is published, has subscription billing, and defines a non-empty usage meter. A prepaid pack may remain available inside Usage on a qualifying site, but never enables the tab by itself. This is more reliable than using account state, which varies by reader and can expose a tab on a site that does not sell metered service.
2. **Apply the gate before Usage reads and routing.** The combined Billing page derives availability from the site catalog; reader balances, history, preferences, payment state, and read errors cannot override it. A `#usage` link on a site without a qualifying offer keeps Membership selected. Existing `/app/usage` redirects and query preservation remain intact.
3. **Keep panel content independent of eligibility.** Once a site qualifies, any signed-in reader can open Usage. The existing no-data, no-pack, automatic top-up, and retry states continue to describe the available controls and reader data.
4. **Keep the page label concise and data ownership unchanged.** The signed-in page uses “Billing” as its heading and has no Account eyebrow or explanatory intro. Any sign-in copy remains editable and specific to the Billing route. No animations are introduced. The site owns its product catalog; readers own their balances, activity, and preferences.

## Risks / Trade-offs

- [A site's only metered offer is unpublished while readers still have old balances or settings] → Usage becomes unavailable by design; records remain stored and become reachable again if the site publishes a qualifying offer.
- [The definition of a metered plan drifts between eligibility and catalog validation] → Use the same published/subscription/meter fields already documented for metered offers and cover prepaid-only and unpublished offers with focused tests.

## Migration Plan

No data migration is required. Rebuild and deploy the theme and refreshed Usage billing guide. Roll back by restoring the previous catalog-eligibility behavior; reader data and payment configuration are unaffected.
