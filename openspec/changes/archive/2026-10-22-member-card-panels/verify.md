# Verification

Applied on 2026-10-21 at James's request. Not archived: read it, then `/opsx:archive`.

| Scenario | Result | Evidence |
| --- | --- | --- |
| a site with no panels | **passed** | `member-panels.test.mjs`: every kit panel off and none of the site's own leaves nothing to draw. |
| the panels are site-registered | **passed** | `member-panels.test.mjs`: a site's own panel after the kit's, its order honoured, what it does not name keeping its place after; no site named in the kit's panels. |
| a site with every module on | **passed** | The demo's card rendered for its own member (the administrator) at 1280 and 390 px, light and dark: "What you have read" with the seeded reading history, "What you have bought" with its empty sentence, and no Working panel (the demo names no instrument of its own). |
| a module that is off | **passed** | `member-panels.test.mjs`: the store off draws no Bought panel, so no read of purchases is made for it. On the club (spaces off there is no card at all), `member-panels-db.test.mjs` stands down by name. |
| another member asks | **passed** | `member-panels-db.test.mjs` on a fresh demo stack (11 checks): another member is answered `[]` / `null`, exactly as nothing to show; `ownership.test.mjs` derives `may_see_member` as the guard. |
| a site rewords, turns off and adds | **passed** | `member-panels.test.mjs`: `off`, own `panels` and `order`; the theme's words for every panel's two titles and empty sentences. |
| the card and the admin agree on purchases | **passed** | `member-panels-db.test.mjs`: the card's Bought ids equal the admin person page's paid purchases, in order (`person_purchases`, one source). `people-db.test.mjs` passes 23 with the admin page on it. |
| the instrument's own words | **passed in part** | `member-panels.test.mjs`: Working reads level names from `#site/instrument`. DharmaLab's card, rendered on its own e2e stack after its copies were removed (1280 px, light), shows Working, Read and Bought in its original order with its own words and reading history; its seed holds no diagnostic result, so a level name was not on screen. |

Also: `function-bodies.test.mjs` compiles all 461 SQL functions; the assembler refuses a site schema redefining a kit function, shown on DharmaLab before its copies were removed. DharmaLab's change is in its own checkout, uncommitted: its three components, `member.js`, `db/schemas/10-member.sql` and the `spaces.member` line removed.
