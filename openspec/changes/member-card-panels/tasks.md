# Tasks

## 1. The data

- [ ] 1.1 Add `person_purchases` to the kit's schema (newest first; a limit and paid-only for the card, every status for the admin), and make `admin_person` embed it. Verified by `member-panels-db.test.mjs`: the card and the admin list the same purchases in the same order; `ownership.test.mjs` passes.
- [ ] 1.2 Move `member_read`, `member_working` and `member_bought` into the kit's schema beside `may_see_member`, each asking it first, `member_bought` reading `person_purchases`. Verified by `member-panels-db.test.mjs`: own card, staff, and another member answered exactly as nothing to show; `function-bodies.test.mjs` compiles them.
- [ ] 1.3 Make the assembler refuse a site schema file that redefines a kit function by name, naming both files. Verified by an `assembled-tree.test.mjs` check with a planted redefinition.

## 2. The panels

- [ ] 2.1 Move the three components into `packages/movable-types/src/components/spaces/panels/`, reading their words from the theme's `spaces.md` `member-panels` (the defaults in the proposal) and Working's level names from `#site/instrument`. Verified by `member-panels.test.mjs` (level names, never a key) and the card rendered at 390 and 1280 px in both themes.
- [ ] 2.2 Make core's `#site/member` the kit's panels gated by module (Working: the instrument module on and the site's vocabulary naming a level; Read: library and analytics; Bought: the store), then the site's `member: { off, panels, order }`. Verified by `member-panels.test.mjs`: every gate, `off`, `order`, and a site's own panel in its place.
- [ ] 2.3 Rewrite the extension-model requirement's scenario so no site's panels are named in a kit specification. Verified by `openspec validate member-card-panels --strict`.

## 3. The sites

- [ ] 3.1 The demo: its cards show Read and Bought, and no Working. Verified by its card rendered for the member, for staff, and for another member (no private half).
- [ ] 3.2 The club: the store is off, so no Bought panel, and no purchases read for it. Verified by `member-panels-db.test.mjs` under `platformkit test --e2e` on `sites/club`.
- [ ] 3.3 Write DharmaLab's own change, in its repository and not committed here: delete `src/community/Member*.vue`, `src/community/member.js` and `db/schemas/10-member.sql`, and drop `member` from its config. Its strings stay. Verified by its card rendered before and after, matching.

## 4. Docs and verification

- [ ] 4.1 Update the docs site's pages for the extension model and the community's member card, naming the new sources. Verified by `node packages/kit/build/docs-check.mjs`.
- [ ] 4.2 Run `platformkit test --e2e` over every site with a backend and report each scenario in the spec as passed, failed or not verified, with why. Verified by `verify.md`.
