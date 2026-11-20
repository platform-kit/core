# Tasks

- [x] 1.1 The checkout page, its route and strings, in the core. Verified in a browser on DharmaLab with the store off: desktop, a phone and dark, no sideways scroll; an unknown offer says so.
- [x] 1.2 The Pricing section, a membership's own button and an old store address lead to it. Verified in a browser; the route census records the new addresses and nothing else moved (`build/module-routes.test.mts`, 6/6).
- [x] 1.3 `checkouts_started`, `checkouts_left`, `my_checkout_left`, with their grants. `build/declarations.test.mts` 1368/0.
- [x] 1.4 `create-checkout-session` records the checkout. Verified: a real checkout for Group Mentorship's monthly term wrote its row against the offer.
- [x] 1.5 `abandoned-checkout` and `abandoned-offer` in the audience grammar, the database and the audience editor. Verified against the database: left now matches, left 3h+ does not yet, another offer does not, and a paid purchase removes the person.
- [x] 1.6 Documentation: payment plans, funnels, the frontmatter reference. `docs-check` passes.
