## ADDED Requirements

### Requirement: For You is worked out from what the reader did

The `recommendations` module SHALL show a personal "For You" shelf drawn from what the reader has read and bought. Pieces already read and books finished SHALL drop out, and the shelf SHALL be shown only when there is something to recommend. With no reading history, it SHALL invite the reader to start reading or take the site's assessment.

#### Scenario: interests from reading

- **WHEN** a reader has read several pieces on one subject
- **THEN** their interests include that subject, computed from the rows and not stored

Verified by: `build/recommendations.test.mts` under `platformkit test --e2e`

### Requirement: Recommendations on assessment results

A site's assessment results SHALL be able to carry recommendation panels drawn from the same interests.

#### Scenario: results with recommendations

- **WHEN** a reader finishes an assessment on a site with recommendations on
- **THEN** the results show recommendations

Verified by: no test yet
