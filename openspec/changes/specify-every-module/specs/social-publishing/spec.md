## ADDED Requirements

### Requirement: Accounts on eight networks

The `social-publishing` module SHALL connect accounts on X, Reddit, Threads, Bluesky, YouTube, TikTok, Instagram and LinkedIn, directly or through a managed route (Zernio, Post for Me, PostFast). Each provider's tokens SHALL be kept in Vault, never in a table a client reads.

#### Scenario: what each provider can do

- **WHEN** an operation is asked of a provider that does not support it
- **THEN** it is refused by the capability matrix before any call is made

Verified by: `build/social-capabilities.test.mjs`, `build/social-provider-matrix.test.mjs`, `build/social-security.test.mjs`

### Requirement: Publishers act only within their permissions

Staff SHALL invite publishers with permissions per account. An account MAY require approval, and a post to it SHALL wait in a "Needs approval" queue.

#### Scenario: a publisher without permission

- **WHEN** a publisher posts to an account they have no permission on
- **THEN** it is refused

Verified by: `build/social-permissions.test.mjs`, `build/social-admin.test.mjs`

### Requirement: Scheduled posts are delivered and their outcome kept

A post SHALL be drafted with media and scheduled in a chosen time zone. Each delivery to each account SHALL be recorded with every attempt and its outcome. A failed post SHALL be retryable or markable as published, and a published one removable from the platform.

#### Scenario: a failed delivery

- **WHEN** a provider rejects a scheduled post
- **THEN** the attempt and its reason are recorded and the post can be retried

Verified by: `build/social-delivery.test.mjs`, `build/social-outcome.test.mjs`, `build/social-publishing.test.mjs`

### Requirement: An inbox and keyword automations

Verified provider activity SHALL arrive in an inbox. Keyword automations SHALL reply publicly or by message, either reviewed first or sent automatically, with a history that can be reviewed, edited or discarded.

#### Scenario: a matching comment

- **WHEN** a comment matches an automation's keyword
- **THEN** a reply is generated for it, held for review or sent as the automation says, and recorded once

Verified by: `build/social-automation.test.mjs`, `build/social-automation-db.test.mjs` under `platformkit test --e2e`, `build/social-webhooks.test.mjs`

### Requirement: Analytics per post and per account

The module SHALL collect each delivery's impressions, reach, engagement, clicks, views, likes, comments and shares, as snapshots in time.

#### Scenario: a metrics snapshot

- **WHEN** a provider's measurements are collected for a delivery
- **THEN** a snapshot is kept with only the measurements that provider supports

Verified by: `build/social-metrics.test.mjs`, `build/social-metrics-db.test.mjs` under `platformkit test --e2e`
