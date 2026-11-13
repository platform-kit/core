## ADDED Requirements

### Requirement: A one-off data change runs once per database

A module or site SHALL be able to declare a one-off data change. Each database SHALL run it exactly once, after the schema is brought to its declaration and before the standing rows, under the destructive-change guard, and SHALL record that it ran. A recorded change whose contents have since changed SHALL be refused.

#### Scenario: a new change

- **WHEN** a database is migrated with a one-off change it has not run
- **THEN** the change runs once and is recorded

Verified by: `build/data-once-db.test.mts` under `platformkit test --e2e`

#### Scenario: migrated again

- **WHEN** the same database is migrated again
- **THEN** the change does not run again

Verified by: `build/data-once-db.test.mts`

#### Scenario: an edited change

- **WHEN** a change that already ran is edited and the database migrated
- **THEN** the migration is refused, naming the change

Verified by: `build/data-once-db.test.mts`

#### Scenario: a destructive change

- **WHEN** a one-off change deletes rows
- **THEN** it is refused unless destructive changes are allowed for that run

Verified by: `build/data-once-db.test.mts`
