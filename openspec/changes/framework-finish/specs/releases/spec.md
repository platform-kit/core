## ADDED Requirements

### Requirement: The public interface changes only with a recorded change

All PlatformKit packages SHALL share one version. A report of the public interface (the module front doors, the named shared exports, the hook signatures and the event catalogue) SHALL be kept in the repository, and a change to it without a recorded release note SHALL fail `platformkit check`. Under 1.0, a change to the public interface SHALL need a minor version and an upgrade note; a patch SHALL NOT change it.

#### Scenario: an interface change without a note

- **WHEN** a front door's export changes and no release note is recorded
- **THEN** `platformkit check` fails, naming the change

Verified by: `build/releases.test.mts`

#### Scenario: an internal change

- **WHEN** a file behind a front door changes and the report does not
- **THEN** the check passes with no note needed

Verified by: `build/releases.test.mts`

#### Scenario: one version

- **WHEN** a release is versioned
- **THEN** every PlatformKit package carries the same version

Verified by: `build/releases.test.mts`
