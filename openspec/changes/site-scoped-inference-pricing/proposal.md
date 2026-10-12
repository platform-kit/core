# Proposal

## Why

Independent sites need independent inference economics: PlatformKit's shared model price table cannot represent each business's providers, negotiated costs, fallback chain, or markup. OpenAI-shaped responses may report token counts, but do not provide a portable, authoritative per-request dollar charge, so site-owned rates and a fail-safe usage policy are necessary to keep billing understandable and prevent silent zero-cost settlements.

## What Changes

- Let each site declare its ordered inference providers, model choices, fallback policy, provider-specific cost schedules, and customer pricing/markup rules in its site configuration.
- Let each inference-using operation declare its own billing policy: site-funded use, a prepaid usage offer, or a metered subscription offer. One operation's policy never silently applies to another.
- Keep credentials as named deployment secrets; compile only non-secret settings into that site's server runtime, never its browser bundle or another site's configuration.
- Normalize provider usage on the server. Require known tariffs before paid work; missing or unsupported usage must never become a zero-cost settlement. Account for each fallback attempt against its actual provider/model tariff or a conservative reserved maximum.
- Keep each operation's usage offer, customer-facing unit and sale price distinct from the site's provider cost and markup policy. A site-wide markup is only a default; operation-level and offer-level overrides are supported.
- No reader-facing copy changes are proposed; this is site configuration, provider accounting, and administrator pricing behavior.

## Capabilities

### New Capabilities

- `inference-pricing`: site-owned inference providers, fallback order, provider/model tariffs, usage measurement, and cost-to-customer pricing.

### Modified Capabilities

- `platform-data`: billable invocation authorization and settlement use the selected site's provider configuration and cannot silently settle unknown or unmeasured work as zero.

## Impact

`platformkit.config.js` validation and generated server configuration; provider selection and usage adapters; usage reservations, records, and meter reporting; pricing administration; deployment validation; configuration and usage-billing documentation. Existing sites retain their current provider behavior until they declare inference billing configuration.
