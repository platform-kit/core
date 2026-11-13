## ADDED Requirements

### Requirement: Both content paths refuse the same entries

For every content model, an entry that breaks one of its rules SHALL be refused with the same message whether it arrives as a file in the build or is saved through the admin, in a site that keeps content as files and in one that keeps it as rows.

#### Scenario: every rule on every path

- **WHEN** an entry breaking each rule of each model is built, and saved through the admin in a files site and in a rows site
- **THEN** each is refused, with the same message on every path

Verified by: `build/content-parity.test.mts`
