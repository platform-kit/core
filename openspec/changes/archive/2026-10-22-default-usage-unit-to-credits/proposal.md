# Proposal

## Why

Sites currently have to choose a unit for every usage offer, even when a general-purpose “credits” unit would be sufficient. Defaulting an omitted unit to credits lets sites omit that choice while preserving any unit they explicitly configure.

## What Changes

- Default an omitted or blank usage-offer unit to “credits” during catalog compilation, and permit metered offers to omit the unit.
- Preserve explicit offer units. Use a recorded event unit for historical activity only when the offer has no unit; otherwise use “credits” as the final display fallback.
- Do not convert usage quantities or change rates. When a site omits the unit, its declared usage rate applies per credit.
- Reader-facing copy: **Purpose:** label usage measured in the default unit. **Copy:** “credits”.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-billing-usage`: Specify the default unit for usage offers that omit one and the resulting Usage labels.

## Impact

The usage catalog compiler, deployment validation, Usage panel labels, focused tests, and usage-billing documentation are affected. No database migration or numeric conversion is intended; compiled offers pass the resolved unit to existing billing and provider flows.
