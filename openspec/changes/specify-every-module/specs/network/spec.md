## ADDED Requirements

### Requirement: Each member has a page, follows and a timeline

The `network` module SHALL give each member a page, follows, a following timeline that includes pinned spaces' feeds, and a Discover timeline. A post SHALL take replies, likes, reposts and up to 10 photos or videos with alt text.

#### Scenario: what a post may carry

- **WHEN** a composer is handed more than 10 items, or an item of a kind it does not take
- **THEN** it refuses the post

Verified by: `build/network-media.test.mts`

### Requirement: A post's audience holds by every path

A post's audience SHALL be everyone, the site's members, or a space's members, and a reply SHALL reach no more people than the post it answers. The audience SHALL hold on every path the site's pages use to read a post.

#### Scenario: three posts, three readers

- **WHEN** posts for everyone, for members and for one space are read by a guest, a member and a space member
- **THEN** each reader sees exactly the posts their audience allows, by every read path

Verified by: `build/network-db.test.mts` under `platformkit test --e2e`, `build/network.test.mts`

### Requirement: Safety and moderation

A member SHALL be able to block, mute and report. An administrator SHALL be able to remove posts and suspend a person for a day, a week, a month or until lifted. Reading or posting MAY be made a paid feature.

#### Scenario: a suspended member

- **WHEN** an administrator suspends a member
- **THEN** that member cannot post until the suspension ends or is lifted

Verified by: no test yet

### Requirement: The network is an atproto server

The network SHALL be served as an atproto personal data server and app view, so that Bluesky's app and other atproto clients sign in with app passwords the member makes and revokes, when the site allows it. A member SHALL be able to join the wider Bluesky network, with a handle and their public posts shared, and leaving SHALL warn that copies may remain.

#### Scenario: Bluesky's own client

- **WHEN** `@atproto/api` signs in with an app password and reads the timeline
- **THEN** it reads the member's own timeline, and a post it makes appears on the site

Verified by: `build/atproto.test.mts`, `build/atproto-interop.test.mts` under `platformkit test --e2e`
