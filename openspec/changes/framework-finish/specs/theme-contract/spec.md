## ADDED Requirements

### Requirement: An override is checked against what it replaces

An override SHALL be checked at build against the original's contract: its props, events and slots. An override missing a required prop, an event or a slot SHALL fail the build. The site SHALL record the contracts it overrode, and when the kit changes an original's contract or source, the build SHALL warn, naming the override and the change, until the site accepts it.

#### Scenario: an override that breaks the contract

- **WHEN** an override omits a slot its original provides
- **THEN** the build fails, naming the override and the slot

Verified by: `build/override-contracts.test.mts`

#### Scenario: the original changes

- **WHEN** the kit adds a prop to an overridden component
- **THEN** the build warns, naming the override and the new prop, until `platformkit overrides accept` is run

Verified by: `build/override-contracts.test.mts`
