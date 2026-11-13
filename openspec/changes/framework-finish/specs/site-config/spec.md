## ADDED Requirements

### Requirement: Every configuration section is typed and checked

Every section of a site's configuration SHALL have a schema, with modules contributing the schemas of their own sections. A site's configuration SHALL be type-checked in the editor, and at load an unknown key SHALL fail with the nearest known key, and a wrong value SHALL fail with its path.

#### Scenario: a mistyped key

- **WHEN** a site's configuration has `modules.cources`
- **THEN** loading fails, suggesting `courses`

Verified by: `build/site-config.test.mts`

#### Scenario: a wrong value

- **WHEN** a module's section has a value of the wrong type
- **THEN** loading fails, naming the path and the expected type

Verified by: `build/site-config.test.mts`

#### Scenario: every fixture loads

- **WHEN** each fixture site and the demo is loaded
- **THEN** each loads with no error

Verified by: `build/site-config.test.mts`

#### Scenario: a module off

- **WHEN** a module is off and its section is still present
- **THEN** loading warns that the section is unused, and does not fail

Verified by: `build/site-config.test.mts`
