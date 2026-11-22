## ADDED Requirements

### Requirement: A community can open on an overview

With `home.overview: true` in `content/community.md`, the community's Home SHALL show a greeting over the community's name and tagline, then the cards that have something to say for this reader. The feed SHALL be drawn below the cards only once the community has a post, and Home SHALL show no empty state while it has none. Without the setting, Home SHALL be unchanged.

#### Scenario: a community with no posts

- **WHEN** a signed-in member opens Home on a community with `home.overview: true` and no posts
- **THEN** they see the greeting and their cards, and no "No posts yet"

Verified by: a member's Home driven in a browser on a site with the overview on

#### Scenario: posts arrive

- **WHEN** the community has a post
- **THEN** the feed is drawn below the cards

Verified by: a member's Home driven in a browser with one post in the community

### Requirement: Modules and the site add cards

Spaces SHALL declare a `home` slot. A module's fill and an entry of the site's `community.home` SHALL each add a card, ordered by `order`. A card whose module is off SHALL NOT be drawn, and the build SHALL refuse a site card with no component or with a key already in use.

#### Scenario: the courses module is switched off

- **WHEN** a site switches courses off
- **THEN** Home has no Course card

Verified by: `packages/kit/build/module-slots.test.mts` and `packages/kit/build/community-home.test.mts`

### Requirement: Each card falls back rather than standing empty

The Course card SHALL show the course in progress and its next lesson, else a course to start, else nothing. The Coaching card SHALL show the next session the reader attends, else a way to book one where a plan of theirs includes sessions, else the site's link to its coaching. The Reading card SHALL show up to three books in progress, else the site's suggestions for this reader, else the library's first books.

#### Scenario: a reader with nothing behind them

- **WHEN** a member who has started no course, booked no session and opened no book opens Home
- **THEN** the Course card offers a course to start, the Coaching card links to coaching, and the Reading card shows books from the library

Verified by: a fresh member's Home driven in a browser
