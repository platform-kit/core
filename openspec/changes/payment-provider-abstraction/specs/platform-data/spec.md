# Spec Delta

## ADDED Requirements

### Requirement: External payment references are provider-scoped

Payment customer, checkout, payment, subscription, price, and event references SHALL identify the provider that issued them. Reconciliation and idempotency SHALL never treat an identifier from one provider as belonging to another. Existing Stripe-backed purchases, subscriptions, usage grants, and event history SHALL remain associated with Stripe and retain their current meaning when provider references are migrated or read through compatibility behavior.

#### Scenario: Same external identifier from different providers

- **WHEN** two providers deliver events with the same external event identifier
- **THEN** each event is independently namespaced and can affect only records belonging to its provider

Verified by: `build/payment-provider-db.test.mjs` against the declared local schema

#### Scenario: Existing Stripe records after data migration

- **WHEN** a database containing existing Stripe-backed purchase, subscription, and usage records receives the provider-reference migration
- **THEN** every record remains associated with Stripe, reconciliation remains idempotent, and no purchase, subscription, grant, or entitlement is duplicated, lost, or reassigned

Verified by: `build/payment-provider-db.test.mjs` against a populated local database

### Requirement: Commerce records use provider-neutral checkout identities

Purchases, orders, bookings, booking fulfillments, entitlements, and payment transactions SHALL use a stable checkout or payment identity that cannot collide across providers. Raw provider identifiers SHALL remain in `payment_provider_refs`; legacy Stripe columns SHALL remain readable and SHALL be written only for Stripe. Existing Stripe rows SHALL retain their current identity and behavior.

#### Scenario: Different providers return the same checkout identifier

- **WHEN** two providers complete checkouts with the same external checkout identifier and line price identifier
- **THEN** the shared ledger records each provider's purchase and fulfillment independently, and repeated reconciliation for either checkout updates only its own rows

Verified by: `build/payment-provider-db.test.mjs` and `build/ledger.test.mjs`

#### Scenario: Existing Stripe commerce identities are backfilled

- **WHEN** the declared schema and repeatable data plan run against existing Stripe purchases and bookings
- **THEN** their provider-neutral checkout identities equal the existing Stripe checkout IDs, and existing entitlement, order, and booking associations remain unchanged

Verified by: `build/payment-provider-db.test.mjs` against a populated local database
