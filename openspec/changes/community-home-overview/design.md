# Design

## Where it sits

Home is the network's column (`view === 'net'`) in the community. With `home.overview` on, that view draws `CommunityHome` instead: the band, the cards, and — once `network_timeline` returns a row — the network column beneath, so the feed is exactly the feed it was. Explore, a post's thread and every other address are unchanged.

## Cards

A card is a component with no props of its own beyond what every card gets. It decides for itself whether it has anything to say and emits `empty` when it has not; the grid drops it. Order is a number (`order`); the kit's are Course 10, Coaching 30, Reading 40, and a site card defaults to 20.

| Card | Owner | Shows | Falls back to |
|---|---|---|---|
| Course | courses (`spaces:home`) | the enrolled course most recently worked in: its next lesson and progress, linked into the player | the first course the reader may start; nothing if none |
| Coaching | core, where `coaching.where` is `spaces` and sessions exist | the next upcoming session the reader attends, with its time and a link to it | Book a session (a plan of theirs lists a session type) → the Coaching place; else the `href` in its strings |
| Reading | core, when the library has books | up to three books in progress, most recent first, with their bars | the site's prescribed books (`#site/recommendations` `signals().prescribed`), then the library's first books with finished ones dropped |

Reading takes the site's prescriptions rather than running the hub's ranking: the ranking loads an embedding model, which a front page should not pay for.

## Sources of cards

- **Modules:** spaces declares a `home` slot. A fill is `{ key, component, order? }`, resolved the same way `spaces:place` is.
- **The site:** `community.home` in `platformkit.config.js`, a list of `{ key, component, order? }`. A key a module already uses, or a missing component, refuses the build.
- `#site` exports `homeCards`: every card's key, order and a loader.

## Layout

One column on a phone; on wider screens a two-column grid, with the Reading card spanning both columns when it would otherwise sit alone at the end. The band is the front page's own (community name, tagline, cover or the community's tint) so Home and the spaces front look like one product.
