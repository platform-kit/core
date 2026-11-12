## ADDED Requirements

### Requirement: A member's public repository keeps every change

When a joined member's public records change, their repository SHALL come to hold the change, however many updates of it run at once. A new version SHALL be saved only if it is built on the version currently saved, and an update that loses SHALL build again from the saved one. Blocks a version lets go SHALL be removed only after it is saved. A member's "needs updating" mark SHALL be cleared only by an update that succeeded, and never a mark made after that update read it.

#### Scenario: two updates at once

- **WHEN** two commits are built on the same saved version
- **THEN** the first is saved, the second is refused and the saved version stays the first's, and a first commit built on nothing is refused once a repository has one

Verified by: `build/network-db.test.mts`

#### Scenario: a post just after joining

- **WHEN** a member joins and at once posts to everyone
- **THEN** the repository the sync methods serve verifies against their key and holds the post

Verified by: `build/atproto-interop.test.mts` under `platformkit test --e2e`
