# Spec Delta

## ADDED Requirements

### Requirement: Payment deployment requirements follow the selected provider

When site content enables paid offers, deployment validation SHALL require the selected provider's configuration and credentials before any deployment command runs. Stripe-only sites SHALL retain their current Stripe requirements. Prism-only sites SHALL be checked for selected-connector credentials and SHALL NOT require an external Prism endpoint or service. A missing setting SHALL be reported with the provider or connector that needs it.

#### Scenario: A Prism-only site is missing a required setting

- **WHEN** a site enables paid offers, selects Prism, and omits a required connector setting
- **THEN** deployment is refused before commands run and the report identifies the missing connector credential without requesting Stripe credentials or a Prism service URL

Verified by: `packages/kit/build/deploy-checks.mjs --test`

#### Scenario: A Stripe site keeps its current deployment requirements

- **WHEN** a site uses native Stripe for paid offers
- **THEN** deployment continues to require the current Stripe live key and webhook secret and does not require Prism settings

Verified by: `packages/kit/build/deploy-checks.mjs --test`

#### Scenario: No paid offers are enabled

- **WHEN** a site enables neither paid offers nor payout workflows
- **THEN** deployment does not require Stripe or Prism credentials solely because those providers are available in PlatformKit

Verified by: `packages/kit/build/deploy-checks.mjs --test`
