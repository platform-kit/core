# page-sections

## Purpose

The page builder's catalogue: the sections a marketing site expects — a hero that takes any visual, logos, features, a split, stats, testimonials, an FAQ, a team, a comparison, a gallery, a video, prose, a timeline, a bento, a quote, a contact block — each generic, each drawn in the site's look, each a form in the builder; and the seam by which a site plugs its own meaning into the hero (a stage) instead of the kit carrying it.

## Requirements

### Requirement: The hero takes a visual, and a site's stage is one

The Hero section SHALL take, beside its words (headline lines, a sub-line, a first button and a second, fine print), a `visual` of one kind: `none`, `image` (a picture with alt text), `video` (a file or an embed, muted and looping beside the words), `frame` (a screenshot inside a browser window), or a **stage** a site registers — `landing.stages` in `platformkit.config.js`, a module exporting `STAGES` (key → component) and a schema each, joined to the hero's choices at load. The kit SHALL carry no stage of its own: site-specific visual stages SHALL be registered by the site, and no kit component SHALL name a site's quiz, level or recommendation. A page's hero SHALL keep a stage's words under `stage:`, edited in the builder as that stage's schema draws them, shown only while its kind is chosen.

#### Scenario: a registered hero stage

- **WHEN** a site's landing page is built after the change
- **THEN** the site-provided stage renders beside the hero's words, and the kit's landing components contain no site-specific concepts

Verified by: screenshots of `/` before and after, both themes; `build/sections.test.mjs` (the kit's landing components contain no site-specific concepts)

#### Scenario: a hero with a frame

- **WHEN** the demo's hero says `visual: { kind: frame, image: … }`
- **THEN** the screenshot is drawn inside a browser window beside the words, and the builder's form shows the frame's fields and not a stage's

Verified by: screenshots on the demo, both themes, 1280 and 390

### Requirement: The catalogue

The theme SHALL ship these sections, each a component under `components/landing/`, its registry line and its schema agreeing (the `publishing` rule), each with named slots wrapping its blocks so a skin may rebuild it, each rendering nothing where a page leaves a block empty: **Announcement** (a strip at the head: a badge, a line, a button, a code copied on a click; dismissable for the session, sticky when asked; when it is the page's first section it SHALL hand the absolute site header its height, so the header comes below it), **Hero** (layouts split · centred · backdrop; the visual as below, in a browser, a phone or a laptop too (`Device.vue`); the headline arriving line by line, word by word or at once (`arrive`); faces and a line, a rating, stats, an email field in place of the buttons, store badges, cards floating over the visual — a card, a chat bubble or a number at any corner, always paper whatever the tone, beside a phone rather than at the column's corners — cards under, a scroll arrow), **Cta** (centred · split · band · bar · cards · promo over a photograph with a whole-card scrim and a "from" line), **Countdown** (centred · strip; a date and time, else a span from the reader's first visit; the words when it is over), **Marquee**, **Divider** (line · ornament · space), **Logos** (row · chips · beside · marquee · tiles), **Perks** (strip · cards · grid · inline; a glyph or a picture), **Features** (cards · plain · bordered · list · showcase · flip · around a picture; the cards may tilt toward the pointer), **Split**, **Bento** (as before), **Showcase** (scroll · tabs · flip; features beside one screen in a device, the picture changing with the feature; on a phone the scroll layout keeps its picture stuck under the header), **Before / after** (two pictures under a dragged handle), **Carousel** (cards · arc · coverflow · strip; autoplay; the perspective in each card's own transform so a turned card never paints through its neighbour; cards opaque over the paper), **Tabs** (pills · underline; the `variant`, never `style`), **Steps** (across · down · alternating · path · numbered · beside a screenshot in a device · spine · timeline), **Stats** (row · cards · beside · serif; the numbers may count up), **Testimonials** (grid · wall · one · switcher · marquee · tweets · bubbles · photo · faces with a video · stack), **Quote**, **Pricing** (columns · rows · single · choice · selector; a `- ` feature crossed out, a glyph and a "from" per rung; the featured tone; the compare table), **Compare**, **FAQ** (beside · stacked · columns · picture · icons · gallery; a prefix; faces on the more card), **Team** (grid · circles · rows · photo · mono with logos · tiles · marquee · solo), **Integrations** (tiles · orbit · marquee · scatter, each mark placed by its own transform and so off the reveal), **Gallery** (grid · masonry · polaroids · scatter · arc · mosaic · lookbook; filters by tag), **Video**, **Timeline** (list · columns; a percentage in place of a date), **Articles**, **Prose**, **Newsletter** (centred · split · card; a first name too), **Contact** (beside · card · cards · quote), **Footer** (columns · mega · minimal; the mark, columns of links, social glyphs, an email field, the legal line with `{year}`) — and, with the store module on, **Products** (all · featured · a collection · a tag · skus; cards · bordered · rail · list; the store's own `ProductCard`, which draws the product's `compare` price and `rating` / `reviews`), **Spotlight** (one product: gallery, price and old price, stars, points, sizes, quantity, add, a trust line, a drop's countdown and stock) and **Collections** (tiles · icons · banners · circles). A section's root class from its layout (`lpr-choice`) SHALL never be shared by an inner element. An email captured on a page — the Newsletter's, a Cta's, the hero's, the footer's — SHALL be a closed response to one of the site's forms that has an email field (`lib/capture.js`, a name field by its name), so it lands in Forms → Responses with the form's own delivery; a section SHALL keep no list of its own. A marquee SHALL be one shared `Ticker` (as before). Every word a section shows SHALL be the page's markdown; the few of the section's own (Next, Previous, Close, Show, the email field's states, Step {n}, Read, the countdown's units, All on a gallery's filters, Add to bag, the reviews count) SHALL be the `sections` strings scope (the reviews word the store's). A glyph SHALL be chosen from a palette (`GlyphPicker.vue`: the theme's twenty and Lucide's, searched, floating over the page) and drawn by name (`landing/icons.js`, the build's `icons.mjs` writing only the glyphs the pages name — every one in dev — into `.velite/icons.json`, the first step of the prepare phase).

#### Scenario: every section on the demo

- **WHEN** the demo's `/sections` page carries every section and layout with sample content, and its `/shop` page a commerce page from the store's sections
- **THEN** each renders in the North look, by day and by night, at 1280 and at 390 with nothing at the edge, and the builder opens each as a form

Verified by: screenshots of every section, both themes, both widths, on both pages; `platformkit probe` over `/sections`; a screenshot of the builder on the page

#### Scenario: an empty block

- **WHEN** a section's optional block is left empty (no lead, no second button, no caption)
- **THEN** nothing is drawn for it and the layout closes up

Verified by: the demo page's sections with blocks left empty, in the screenshots

### Requirement: Every section wears the same look fields

Every section but the Marquee, the Close, the Divider and the Announcement SHALL take one fold of look fields, stamped on its root by the page and never props of the component: `tone` (paper · wash · accent · ink — the design remapping the tokens under `[data-tone]`, a card that must hide what is behind it — a deck, a fan — laid over the paper as `lpcard-solid`), `glow` (none · cards · visual · foot · corner), `ground` (none · grain · dots · grid · gradient · aurora), `spacing` (tight · normal · roomy), `width` (narrow · normal · full), `reveal` (how its pictures arrive: none · fade · blur · zoom · tiles) and `anchor`. The builder SHALL show them under one **Section look** fold at the foot of every such form, an unset field showing its default. A page MAY set `progress: true` for a reading-progress bar. In any string `^^word^^` SHALL draw gradient text and `*italic*` the look's serif. A block left at the very foot of the page SHALL still be revealed when the page is scrolled to its end.

#### Scenario: the look fold

- **WHEN** a section's form is opened in the builder
- **THEN** the look fields are folded at its foot, each showing its default until set, and the section on the page wears what is chosen

Verified by: screenshots of the fold open on the demo's `/shop`; the sections' screenshots with tones, glows and grounds set

### Requirement: The sections use generic defaults

Theme sections SHALL use generic defaults. Site-specific meaning and data SHALL be supplied through site registrations, never embedded in a theme default, label or class.

#### Scenario: the defaults

- **WHEN** a new section is added to a page in the builder
- **THEN** its defaults read as a generic example, and `build/sections.test.mjs` finds no site-specific vocabulary in the theme's landing defaults

Verified by: `build/sections.test.mjs`
