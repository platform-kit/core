# Design

## Context

See proposal.md for motivation and specs/account-billing-usage/spec.md for the behavior contract. Usage offers are compiled into the shared catalog consumed by provider and usage services. Today, catalog compilation and deploy validation reject a missing unit, while the Usage panel can read uncompiled product content and event rows with a missing unit.

## Goals / Non-Goals

**Goals:**
- Resolve omitted or blank units consistently to `credits` for compiled offers and reader-facing Usage labels.
- Preserve every explicitly configured offer or historical event unit.
- Keep numeric quantities and rates unchanged; a missing unit means the configured rate is per credit.

**Non-Goals:**
- Convert historical quantities, rewrite stored subscriptions, or migrate the database.
- Change usage-meter calculations, provider event counts, or usage rates.
- Add a per-site global setting; the default applies to each usage offer that omits its unit.

## Decisions

- Use a small shared unit resolver for the precedence `offer unit → recorded event unit → credits`. This keeps the reader panel's balances, activity, and pack labels consistent; duplicating fallback expressions would let those surfaces drift.
- Normalize omitted or whitespace-only units to `credits` in `compileUsage`, so server catalog, provider, and usage-ledger consumers receive the same concrete unit. Remove only the unit-presence deploy rejection; retain meter, positive rate, and overage-price validation.
- Keep explicit offer units authoritative over event metadata. An event unit is a fallback for historical activity whose offer has no unit; it does not override the unit used for an active offer.
- Test the resolver and catalog default directly, and cover deploy validation accepting a metered offer without an explicit unit. Keep this in existing usage and deploy checks; add a focused resolver test for the display precedence.

## Risks / Trade-offs

- A site that omits the unit is declaring its usage quantities and rate in credits, which may not match its intended domain term → Keep explicit units supported, document that the rate is per credit when the unit is omitted, and do not convert numbers.
- Older records may have no offer or event unit → The UI presents credits rather than an unlabeled number; existing stored unit values remain authoritative where present.

## Migration Plan

No database migration is needed. Deploy the compiler, validation, and UI changes together so newly compiled offers carry `credits` through existing provider paths. To roll back after a site has omitted its unit, restore an explicit `usage.unit` before deploying a version that requires it.
