## ADDED Requirements

### Requirement: A site may put a reader's own data in an email

A site SHALL be able to register named reader blocks, each a server-side renderer from one reader's own data to email-safe HTML. A funnel step or blast SHALL be able to place a registered block by name. Each recipient's email SHALL carry the block rendered for them alone. A step SHALL say what happens when a reader's block is empty: the email goes without it, or that step is not sent to them. The build SHALL refuse a block no site registers. An email without a block SHALL be sent exactly as before.

#### Scenario: a reader's results in the email

- **WHEN** a site registers a `results` block and a funnel step places it, and two readers with different results are in the audience
- **THEN** each reader's email shows their own results, and neither shows the other's

Verified by: `packages/kit/modules/funnels/tests/reader-block.test.mts`

#### Scenario: nothing to show

- **WHEN** a step places a block with `skip-when-empty` and a reader in the audience has no results
- **THEN** that reader is not sent that step, and the funnel carries on with the next one

Verified by: `packages/kit/modules/funnels/tests/reader-block.test.mts`
