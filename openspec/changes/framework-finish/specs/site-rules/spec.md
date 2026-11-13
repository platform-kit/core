## ADDED Requirements

### Requirement: A site changes a business rule through a named hook

The kit SHALL provide named, stable hook functions for an item's price, whether a promotion applies, a payout line's amount, and whether a member may read an entry. The kit's own calculations SHALL call them at their documented point. A site SHALL be able to redefine any hook from its own data layer without replacing a kit function. Hook signatures SHALL be part of the public interface.

#### Scenario: no hook redefined

- **WHEN** a site redefines no hook
- **THEN** prices, promotions, payouts and access behave exactly as before

Verified by: `build/site-rules-db.test.mts` under `platformkit test --e2e`, and the existing store, promotion, payout and access tests

#### Scenario: a site's price rule

- **WHEN** a fixture site redefines the price hook to take 10% off one product
- **THEN** the storefront shows the lower price and checkout charges it

Verified by: `build/site-rules-db.test.mts` under `platformkit test --e2e`

#### Scenario: a site's access rule

- **WHEN** a fixture site redefines the access hook to deny one entry to one tier
- **THEN** that tier's members cannot read it through any route, and others can

Verified by: `build/site-rules-db.test.mts` under `platformkit test --e2e`
