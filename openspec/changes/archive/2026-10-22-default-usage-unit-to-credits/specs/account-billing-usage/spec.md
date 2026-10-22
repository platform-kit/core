# Spec Delta

## ADDED Requirements

### Requirement: Usage offers default to credits when no unit is configured
A usage offer with an omitted or blank unit SHALL resolve to “credits” during catalog compilation. A site SHALL be allowed to publish a metered offer without specifying a unit; its declared usage rate SHALL apply per credit. The Usage view SHALL label balances and activity with the offer's resolved non-empty unit when available. For historical activity whose offer has no unit, the view SHALL use the event's non-empty recorded unit, or “credits” if neither provides a unit. Explicit units SHALL remain unchanged, and the default SHALL NOT convert numeric usage quantities.

#### Scenario: A configured offer unit is displayed
- **WHEN** a balance or activity record is shown for an offer with a configured unit
- **THEN** the Usage view labels the quantity with that offer unit, even if an activity record has a different recorded unit
- **Verified by:** `node --test packages/kit/build/usage-unit.test.mjs`

#### Scenario: A usage offer without a unit defaults to credits
- **WHEN** a site compiles a usage offer with its unit omitted or blank
- **THEN** the resulting offer uses “credits”, and a metered offer is not rejected solely because its unit was omitted
- **Verified by:** `node --test packages/kit/build/usage.test.mjs` and `node --test packages/kit/build/deploy-checks.mjs --test`

#### Scenario: A recorded activity unit is used for legacy activity
- **WHEN** an activity record has a non-empty recorded unit but its historical offer has no unit
- **THEN** the Usage view labels the quantity with the recorded unit
- **Verified by:** `node --test packages/kit/build/usage-unit.test.mjs`

#### Scenario: Credits label activity with no available unit
- **WHEN** an activity record has neither an offer unit nor a non-empty recorded unit
- **THEN** the Usage view labels the unchanged quantity in “credits”
- **Verified by:** `node --test packages/kit/build/usage-unit.test.mjs`
