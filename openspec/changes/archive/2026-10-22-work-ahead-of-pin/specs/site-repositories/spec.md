## MODIFIED Requirements

### Requirement: Fetch and update preserve local work

Fetching a site that is not present SHALL create its checkout without changing the PlatformKit repository's tracked files. Updating an existing checkout SHALL preserve its local changes; if applying the newly pinned revision would overwrite local changes, the operation SHALL stop, identify the affected checkout, and leave it unchanged. A checkout at its pinned commit with local commits on top SHALL be accepted by every command that lists sites, which SHALL report how many commits it is past its pin; an update SHALL move the pin forward to a commit that contains the checkout without changing the checkout, and SHALL refuse an update that would leave a local commit behind. A checkout neither at its pin nor built on it SHALL be refused.

#### Scenario: A clean checkout updates

- **WHEN** an existing managed checkout has no local changes and its registered pin changes
- **THEN** the update checks out the new pinned revision and reports the resulting commit

Verified by: `packages/kit/build/site-repositories.test.mjs`

#### Scenario: A checkout has local edits

- **WHEN** an update would replace a checkout with uncommitted or untracked changes
- **THEN** the update refuses before changing any file and tells the operator how to preserve or resolve the local work

Verified by: `packages/kit/build/site-repositories.test.mjs`

#### Scenario: A site is worked on before its commits are pushed

- **WHEN** a managed checkout has local commits on top of its pin
- **THEN** the site runs in the workspace, the listing says how many commits it is past its pin, an update to a pin that would strand those commits is refused, and once they are pushed the pin moves forward to them with the checkout untouched

Verified by: `packages/kit/build/site-repositories.test.mjs`
