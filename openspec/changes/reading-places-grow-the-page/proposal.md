## Why

The community is a frame the height of the window, so a room keeps its composer at the bottom and its menu still. A place a site registers to be read — a page of results, a course — inherited that frame and scrolled inside a panel. On a phone the browser's bar never folded away, back did not return a reader to where they were, and the page did not behave like a page.

## What Changes

- A registered place may say `scroll: 'page'`. Such a place grows the page; on a wide screen the community's menu sticks beside it as it scrolls. `scroll: 'frame'`, the default, keeps today's behaviour. Any other value refuses the build.
- Rooms, messages and every kit place keep the frame.

## Impact

- `packages/kit/build/site.mts` (`placesOf`), `packages/kit/theme/src/pages/SpacesPage.vue`, `packages/kit/build/network.test.mts`.
- Docs: configuration and the config keys reference.
