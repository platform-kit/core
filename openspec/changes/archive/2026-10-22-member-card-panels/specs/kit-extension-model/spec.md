## MODIFIED Requirements

### Requirement: A site registers what a member's card says about somebody

The private half of a member's card SHALL be seen only by that person and by staff, and SHALL show the kit's panels for the modules the site has on, in this order unless the site sets another:

- **Working**, where the site names an instrument of its own and the instrument module is on: the level the diagnostic last placed the person at, the level they have secured, and how many areas they have taken, each level named from the site's own instrument vocabulary.
- **Read**, where the library and analytics are on: the books and articles the person has opened, most recent first, each under the title it had when they read it.
- **Bought**, where the store is on: their paid purchases, newest first, with no payment provider's reference and nothing of any card.

Every panel's words SHALL be the site's strings, with the theme's defaults, and each title SHALL read differently on the person's own card and on somebody else's. A panel with nothing to show SHALL say so in its own sentence. A site SHALL be able to turn off any kit panel, add panels of its own (each a key, a title and a component), and set the order. A site's own panel SHALL be given the person's id and nothing else and fetch what it shows itself.

Every panel, the kit's and a site's, SHALL be drawn only after the database has said the reader may see the private half. Every read behind a panel SHALL ask the same rule again before answering, and a refusal SHALL look the same as nothing to show. A person's purchases SHALL be read from one source by the card's Bought panel and by the admin's person page, so the two never disagree.

#### Scenario: a site with no panels

- **WHEN** a site turns every kit panel off and registers none of its own, and a card is opened
- **THEN** the card draws its public half and nothing else, and no read for any panel is attempted

Verified by: `build/spaces.test.mjs` and `build/member-panels.test.mjs`

#### Scenario: the panels are site-registered

- **WHEN** a site registers panels of its own for its member card
- **THEN** the card draws them with the kit's, in the order the site set, for staff and for the person
- **AND** no site-specific name appears in the theme or the kit

Verified by: `build/sections.test.mjs`, `build/overrides.test.mjs` and `build/member-panels.test.mjs`

#### Scenario: a site with every module on

- **WHEN** a member opens their own card on a site with the library, analytics and store on and no instrument of its own
- **THEN** the private half shows Read and Bought, titled for them ("What you have read", "What you have bought"), and no Working panel

Verified by: `build/member-panels-db.test.mjs` under `platformkit test --e2e`, and the demo's card rendered at phone and desktop width in both themes

#### Scenario: a module that is off

- **WHEN** a site has the store off and a card is opened by staff
- **THEN** no Bought panel is drawn and no read of purchases is made for it

Verified by: `build/member-panels-db.test.mjs` under `platformkit test --e2e` on `sites/club`

#### Scenario: another member asks

- **WHEN** a signed-in member who is not staff asks for somebody else's read, bought or working answer directly
- **THEN** each answers exactly as it would for a person with nothing to show

Verified by: `build/member-panels-db.test.mjs` and `build/ownership.test.mjs` under `platformkit test --e2e`

#### Scenario: a site rewords, turns off and adds

- **WHEN** a site overrides a panel's strings, turns Bought off and registers a panel of its own after Read
- **THEN** the card shows its words, no Bought panel, and its own panel in the place it set
- **AND** no site's name, wording or panel appears in the kit, the theme or a kit specification

Verified by: `build/member-panels.test.mjs`

#### Scenario: the card and the admin agree on purchases

- **WHEN** a person's purchases are read by the card's Bought panel and by the admin's person page
- **THEN** both list the same purchases in the same order

Verified by: `build/member-panels-db.test.mjs` under `platformkit test --e2e`

#### Scenario: the instrument's own words

- **WHEN** a site names an instrument whose vocabulary names its levels
- **THEN** the Working panel shows the site's names for the levels, and never a level's internal key

Verified by: `build/member-panels.test.mjs`, and DharmaLab's card rendered before and after its copies are removed, which must match
