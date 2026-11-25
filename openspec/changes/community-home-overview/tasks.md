# Tasks

## 1. Groundwork

- [x] 1.1 `home.overview` in the community settings and its schema
- [x] 1.2 Spaces' `home` slot; `community.homeCards` checked in `site.mts`; `homeCards` in `#site`

## 2. The page

- [x] 2.1 `CommunityHome.vue`: band, the short cards in one row (three, two or one across; an odd one out spans the row where two fit), Reading the full width beneath, the feed below once there is a post
- [x] 2.2 Course card (courses module), Coaching card, Reading card, with their strings
- [x] 2.3 Drawn for Home in `SpacesPage.vue` when the overview is on, growing the page and as wide as a work place

## 3. Verify

- [x] 3.1 Tests: `community-home.test.mts` 4/0, `module-slots.test.mts` 6/0, `community-nav` 1190/0, strings 34/0 on both sites, kit `tsc` clean
- [x] 3.2 Driven in a browser on DharmaLab at 1440, 1290, 1024 and 390, light and dark, as a member with a course, the admin with books in progress and a stage, and a member with neither; every card's button followed to its page; no "No posts yet" anywhere
- [x] 3.3 Documentation: frontmatter (`home.overview`), config keys and configuration (`community.homeCards`), FEATURES
- [x] 4.1 The Course card the page's width, above Reading (a fill may be `full`; `community.homeCards` too): every course offered whatever its state — not started (its cover, first line and Start the course), under way (bar, required lessons done, next lesson, Continue), finished (full bar, Finished, Review); with one course its name is the card's heading. Seen in a browser as the coach (not started), Priya and the admin (under way) and Member (finished), 1290 light and dark and 390
