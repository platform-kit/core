# Proposal

## Why

A community's Home is its feed. A new community, or one whose owner does not post, opens on "No posts yet": the first page a member sees says nothing is here. The category's leaders open on the member's own standing instead — Circle's Home page (a welcome banner and blocks such as courses and events) and Kajabi's member dashboard (continue learning, your next session). That page is full on the first day and stays full whether anybody posts or not.

## What Changes

- **A community can open on an overview.** `content/community.md` `home.overview: true` makes Home a page of the member's own things: a greeting over the community's name, tagline and cover, then a set of cards.
- **Posts come after the cards, and only when there are some.** The feed is drawn below the cards once the community has a post; until then there is no empty state at all.
- **The kit's cards:**
  - **Course** (courses module): the course in progress and its next lesson, with progress; or the first course to start.
  - **Coaching** (sessions, where coaching lives in the community): the next booked session; or a way to book one where the member's plan includes sessions; or a link to the site's coaching offer.
  - **Reading** (the library): up to three books — the ones being read; else the site's suggestions for this reader; else the library's own first books.
- **Modules and sites add cards.** Spaces declares a `home` slot that any module fills, and a site adds its own with `community.home` in `platformkit.config.js` (`{ key, component, order? }`). A module switched off takes its card with it.
- **Every word is an editable string**, and a card with nothing to say for this reader is not drawn.
- **Nothing changes for a community that does not opt in.**

## Capabilities

### New Capabilities

- `community-home`: an overview Home made of cards, with posts below only when there are any.

## Impact

- `packages/kit/src/lib/spaces/settings.ts` and `build/velite.mts`: `home.overview`.
- `packages/kit/build/modules/kit.mts`: spaces' `home` slot; `build/site.mts` and `vite/index.mts`: the cards for `#site`.
- `packages/kit/theme/src/components/spaces/CommunityHome.vue` and its cards; `SpacesPage.vue` draws it for Home.
- `packages/kit/modules/courses`: the Course card.
- Strings: `theme/src/content/ui/spaces.md` (`## home`), `modules/courses/strings/courses.md` (`## home`).
