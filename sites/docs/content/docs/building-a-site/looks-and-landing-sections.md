---
title: Looks and landing sections
description: One design, a palette per look, skins, and how a section type is three things that must agree.
order: 46
reviewed: 2026-10-10
sources:
  [
    packages/kit/theme/src/components/landing/LandingAnnouncement.vue,
    packages/kit/build/typefaces.mjs,
    packages/kit/build/google-fonts.mjs,
    packages/kit/build/google-font.mjs,
    packages/kit/build/site-fonts.mjs,
    packages/kit/build/fonts.mjs,
    packages/kit/src/lib/share-card.js,
    packages/kit/src/lib/seo.js,
    packages/kit/src/lib/seo-head.js,
    packages/kit/theme/src/pages/SharePage.vue,
    packages/kit/theme/src/looks,
    packages/kit/build/tokens.mjs,
    packages/kit/theme/src/components/admin/TokensField.vue,
    packages/kit/theme/src/tokens.css,
    packages/kit/src/lib/look.js,
    packages/kit/theme/src/components/landing,
    packages/kit/theme/src/pages/SharePage.vue,
    packages/kit/build/share-images.mjs,
    packages/kit/build/theme-look.test.mjs,
    packages/kit/supabase/functions/share-image,
    packages/kit/supabase/functions/_shared/ttf-metrics.ts,
  ]
---

## The typefaces

Three faces, set in `content/site.md` and edited in Settings → Site settings:

```yaml
fonts:
  heading: Playfair Display # headings, the landing's lines, a pull quote
  body: Inter # prose, the person, every control
  mono: JetBrains Mono # code, a key, a figure that must line up
```

Every `font-family` in the theme reads one of three tokens — `--fd`, `--f`, `--m` — so naming a
face here sets the type everywhere at once. The build writes the Google Fonts link and the tokens
into the head, before anything paints; **no site edits its `index.html` to change a face.** A slot
left unset is the theme's own (Fraunces, Bitter, IBM Plex Mono), so a site that names none keeps
the type it has.

Two dozen families are **recommended** (`build/typefaces.mjs`) — each chosen, each with a note
saying what it is for — and beside them the picker searches **every family Google serves**, all
1,949 of them.

What it never is, is a free text field. A typed family name can be one Google does not serve, and
that failure is silent: the stylesheet 404s and the page renders in Times. A family that does exist
may lack the weights the theme asks for, and then the browser fakes the bold. Neither shows up in
review. So every family — recommended or not — is resolved against a **catalogue** of what each one
actually has: `build/google-fonts.json`, compiled from Google's own metadata by
`build/google-fonts.mjs` and committed, so no build reaches the network to learn what a font is and
no admin downloads 2.7 MB to draw a list. `build/google-font.mjs` holds the pure part of it — the
axis string, the fallback stack, which slots a family may fill — because the picker reads it in the
browser and the build reads it under Node.

Naming a family that is not in the catalogue stops the build and says which one you probably meant.
Refresh the catalogue with `node packages/kit/build/google-fonts.mjs`; `--check` says whether it
has gone stale without changing anything.

A look should not set these three. It can carry more than colours in general — a palette is the
least a look can be, not the most — but the type tokens are written into the head so the face is
settled before first paint, and a look's stylesheet loads after that, so one setting `--f` would
quietly win over the face the site chose.

## Changing a colour without editing a stylesheet

A look is a stylesheet, and the person running a site is not going to edit one. So **Site settings offers every colour the look names** — read from the stylesheet itself by `build/tokens.mjs`, never a list anybody maintains, so a look that gains a token gains it in the form.

They are grouped by where they apply, because the same name means different things in different places: `--ink` is one colour site-wide and another on the landing. Each row shows the look's own value behind the field, and the night is behind a disclosure per colour rather than a second column.

What a site changed lives in `content/site.md` under `tokens`, keyed by the look's own selector and the token:

```yaml
tokens:
  '--accent': '#1d7f6e' # site-wide
  '.lproot --ink': '#123456' # the landing's ink
  '--paper': { light: '#fff', dark: '#0b0b0d' }
```

Three things follow from how it is stored:

- **A colour nobody changed is absent**, not a copy of the default. Storing the default would freeze it — every site that had "changed" nothing would keep the old colour the day the look was retuned. So _Put back_ deletes the key.
- **The key carries the look's exact selector**, so an override rebuilds the rule the look itself wrote. A look dresses a surface and then a variation of it, and an override written against the base would apply to both.
- **It is injected as a stylesheet**, last in the head, so it wins by order rather than by out-specifying anything. Inline properties on `<html>` cannot reach a token declared under `.lproot`, which would have silently done nothing for most of the form.

## One design, many looks

The site wears one **look** at a time — `look` in `content/site.md`, chosen in Site settings. Every look shares **one design**: `packages/kit/theme/src/looks/design.css`, the rules under `[data-look]` — the landing's ground as an arc from dusk to light, paper cards, the two materials (the library as paper, the instrument as the lab), the primitives. A look is **only a palette**: one CSS file of tokens under `[data-look="<name>"]`, each with a night variant:

- site-wide on `:root` — `--paper`, `--ink`, `--ink2`, `--ink3`, `--hair`, `--card`, `--accent`, `--accent2`, `--accentbg`, `--sun`, the ramps `--c1…--c4`, the fonts `--f`, `--fd`, `--m`;
- the landing's own on `.lproot` — its light (`--sun`, `--sunbg`), its dusk (`--dusk`), the close's glow (`--closeglow`);
- whatever keeps its own colours rather than reading the site tokens — the instrument's grounds and ramps (`.qz`, `--prog*`), the person's page schemes (`--pg*`), the store's night hero — under `html[data-look="…"]` (html first, to outweigh a scoped style).

The theme's own values — the palette a look overrides, the faces, the shadow — are `src/tokens.css`, a file of nothing but `:root` custom properties, imported by the app before the site's stylesheet and by each embed's entry (the form embed, the support snippet): a widget carried onto another site's page brings its tokens with it, and the site's stylesheet, which styles bare elements, stays behind.

**A rule that is not a colour goes in `design.css`, never in a look; a colour goes in every look, never in the design.** A new colour in a component reads a token so every look gets it; a fixed one is a rule owed to each look.

`lib/look.js` reads the site record and stamps `data-look` on the root before first paint; `?look=<name>` on any url wears that look for the visit; the admin's live preview offers a switch between looks. Fonts are tokens too, loaded in the site's `index.html`.

## A site that declares no look

**The theme ships a palette of its own**, and a site that registers none wears it: its css is
imported, `DEFAULT_LOOK` is the theme's name for it, and `LOOKS` stays empty — so such a site shows
no look switcher, because a switcher offers what the **site** declared. The theme's palette and a
site's own are layers rather than alternatives: declaring one overrides the theme's rather than
filling a hole.

It matters more than it sounds. Before the theme shipped one, a site that declared no look imported
no palette at all: `data-look` was still stamped on the root, every `var(--x)` fell through to an
undefined custom property, and the landing's call-to-action drew its text in the colour of its own
background. A fixture site carried that fault for months and escaped notice only by having no
landing page to show it on. `build/theme-look.test.mjs` holds the fallback now — a config with no
looks resolves the theme's, one with looks resolves its own and not the theme's — and holds every
declared palette to defining every colour the theme reads. The theme default is always checked, so a site with no look still verifies the fallback without needing a site-specific palette.

The three faces work the same way: a face left unset in `fonts` is the theme's.

## A new look

One CSS file of tokens (`src/looks/<name>.css`) and its name in the config's `looks`. The velite `site` schema and the admin's site form take the names from the config, so nothing else is edited. The theme's own `default` (white, cool slate neutrals, an indigo accent) is the complete example, and it is what both sites in this repository wear — a second palette kept in step by hand would only have said the kit looks like something it does not.

## Skins

Every base section (`Landing*.vue`) exposes named slots wrapping whole blocks with the data the default markup uses (`head`, `road`, `chart`, `visual`, … — the comment at the top of each file lists them). A **skin** rebuilds a section on those slots for one look — a marquee as a running head, a path drawn as a ridge into the sun, a close under the sun — and a look's `skins` module maps section names to skin components. The page's markdown names a section once and never changes with the look. Never fork a section into two components or put a look's condition in a template.

## A section type is three things

A landing page is `content/pages/*.md`: a route plus an ordered list of sections, each a component by name with its props. A section type is three things, and all three must agree:

1. **the component**, `Landing<Name>.vue`, with props and defaults;
2. **its registry line** — `SECTIONS` in the theme's `landing/index.js`, or the site's `landing.sections` module;
3. **its schema entry** — `SECTION_SCHEMAS` in the theme's `landing/schemas.js`, or the site's `landing.schemas` module: `group` (the picker's grouping: Openers · Content · Proof · Commerce · People · From the site · Closers, or a group of the site's own; the picker orders the kit's sections within a group as a page tends to use them), `sketch` (the line drawing shown for it, one of `admin/sketches.js`; a section with none gets the generic block), `label`, `description`, `summary(props)`, `defaults` (a plain example that validates — a new block is never born broken), a `zod/v3` schema with `.describe()` labels, and `fieldConfig` — per field: `component` (`textarea`, `markdown`, `image`, `glyph`), `description`, `placeholder`, `half` (two to a row), `labels` (an enum's words), `when(values)` (shown only while it holds), and for a list `item` / `items` (the singular and plural), `summary(row)` and `fields` (the rows' own config).

The schema draws the page builder's form (`admin/SectionFields.vue` walks the zod shape and draws a control per type — a line, a paragraph, a number, a switch, a segmented choice or a select, a picture with an upload, a glyph palette, a list of lines, a list of records as rows that open, a nested record as an inset panel), seeds a new block, and validates the file on save (`validateSections`, the same in the builder and the admin server). It stays on `zod/v3` because the builder reads zod's v3 internals (`_def`); the rest of the admin uses zod 4. The schemas module must be **Node-safe** (no Vue import) since the admin server validates with it.

The theme's catalogue — generic, drawn in the look, carrying nothing of any one site (`build/sections.test.mjs` holds it: the registry and the schemas agree both ways, every default validates, no one site's vocabulary in a component, a default or a label) — is Hero, Cta, Marquee, Logos, Perks, Features, Split, Bento, Steps, Stats, Testimonials, Quote, Pricing, Compare, FAQ, Team, Integrations, Gallery, Video, Timeline, Prose, Newsletter, Contact, How, Library, Coaching, Creator, Close — Articles (the latest articles; with the articles module on, its own chunk) — Form (a form of the site inline; registered with the forms module on, its schema offering the site's forms by slug) and Entries (a content model's entries as cards or a list; with the models module on, its schema offering the models with the section delivery on — `LandingEntries.vue`, its own chunk). A Pricing rung whose offer carries a free trial says so under the price (`First {n} days free`, the store scope's `trial-free`), because somebody deciding whether to subscribe should see it before they press rather than on Stripe's own page afterwards. The demo's `/sections` page carries every one with sample content. A site's own sections are registered from its `src/components/landing`. Shared pieces: `SectionHead.vue` (the eyebrow · heading · lead every section sets), `Ticker.vue` (content doubled and moved forever, across or down, the edges faded, paused under the pointer, still under reduced motion — the logo and testimonial marquees, the bento's cascade), `Stars.vue`, `Avatars.vue`, `EmailCapture.vue` over `lib/capture.js` (an address posted as a closed response to a site form's email field, so it lands in Forms → Responses), `glyphs.js` (the named stroke glyphs a Features, Bento or Split item carries), `md.js` (`md` inline, `mdBlock` for a passage), and `lib/embed.js` (a YouTube, Vimeo or Loom address to its embed, a file to a `<video>`, anything else refused — the Video section and the hero's video visual embed nothing else).

**The look fold.** Every catalogue section's schema is extended with one group of look fields — `tone` (paper · wash · accent · ink), `glow` (cards · visual · foot · corner), `ground` (grain · dots · grid · gradient · aurora), `spacing`, `width`, `reveal` (how its pictures arrive) and `anchor` — that the builder folds away at the foot of the form (`SectionFields.vue`, an unset field showing its default); `LandingPage.vue` takes them off the props and stamps them on the section's root as `data-tone`, `data-glow`, `data-ground`, `data-spacing`, `data-width`, `data-reveal` and `id`, never handing them to the component, and `design.css` paints each under its attribute. `design.css` paints a tone by remapping the tokens under `[data-tone]` — ink ↔ paper, the greys and hairlines re-derived, the button flipped — so a section built on the tokens needs no rule of its own and every look's tone is that look's colours; a card that must hide what is behind it (a deck, a fan of cards) wears `lpcard-solid`, the card's colour laid over the paper, since every look's card is a little translucent. Two rules the catalogue learned the hard way: a section's root class from its layout (`lpr-choice`) is never shared by an inner element, and an element placed by its own transform (the scatter's marks, a rotated quote card — `rotate` as a property instead) is never on the reveal, whose `transform: none` would undo it. The shared pieces the sections are built from live beside them: `Device.vue` (a browser, a phone, a laptop), `CountUp.vue`, `RevealText.vue`, `Ticker.vue`, `Stars.vue`, `Avatars.vue`, `Btn.vue`, `SectionHead.vue`, `ScrollProgress.vue`, `tilt.js` and `icons.js` (a glyph by name: the theme's own, else Lucide's from `.velite/icons.json`). A schema entry may carry `presets` (`[{ label, props }]`), shown at the top of the block's form and laid over its props. A section's root is `<section class="lpsec …">` with the `.lpwrap` inside it, so the tone paints the whole band; the Marquee, the Close, the Divider and the Announcement keep their own roots and take no look fields.

**The Announcement strip outside a page.** `LandingAnnouncement.vue` takes two props no editor field sets: `tone: 'alert'`, the red band of an error the reader must act on, and `remember: false`, a × that lasts the page view instead of the session. The site-wide usage payment banner (`UsagePaymentAlert.vue`) is that strip with both. A strip that is not the page's first section no longer clears the header offset the first one set.

## The hero's visual and a site's stage

The Hero takes, beside its words, a `visual` of one kind — `none`, `image`, `video` (a muted loop), `frame` (a screenshot inside a browser window, the address bar showing the site's host) — or a **stage** the site registers: `landing.stages` in `platformkit.config.js`, a module exporting `STAGES` (key → component), with each stage's schema as `STAGE_SCHEMAS` in the site's `landing.schemas` module (`label`, `description`, `defaults`, `schema`, `fieldConfig` — a section entry without a summary). The hero mounts the stage with the page's `stage:` as its props; the builder shows the stage's fields only while its kind is chosen (the schema entry's `conditional`: `{ on: 'visual.kind', field: 'stage', schemas }` — the one conditional sub-record the builder knows, validated against the chosen kind's schema and no other). The kit carries no stage of its own: a site's own — a diagnostic card, a profile peek — is a stage it registers under `src/components/landing/stages/`, which its How-it-works section (`LandingStage.vue`) draws too.

## The share cards and the icon

Every page has a share image the build draws: `SharePage.vue` at `/__share/<kind>[/<id>]` is a fixed 1200 × 675 frame drawn with the site's components and tokens — the default landing's opening section on its own ground, an article's title over its cover, a book's cover beside its title and author. `share-images.mjs` photographs them at build; `seo.js` points every page's `og:image` at the result. The favicon comes the same way from `/__share/icon?size=N`: the mark on the landing's light gradient, photographed at every size into `dist/icons/`. There is no icon file in `public/`. The share page requests card images eagerly and awaits browser decoding; decode failures are logged rather than silently ignored. Change a card in `SharePage.vue` and look at it at `/__share/…` on the dev server before building.

**Every page points at a share picture, not just an article and a book.** The address is one shape —
`/share/<kind>/<id>.png` — for an article, a wiki entry, a doc, a product, a collection and a
landing page alike. Before this a product with no picture of its own fell through to the site's
default card, so a link to a product showed the site's name; a record naming its own `share` still
wins. **One card draws all of them**, because they are one card: a title, a line and maybe a
picture. A book keeps its own, which is the cover as the title page draws it.

**A long title no longer pushes the card apart.** The text block is anchored to the bottom, which is
right for two lines and wrong for eight: it grew upward, cleared the top of the frame, and ended up
set over the bright part of the picture where the scrim had nothing left to do — a 130-character
title reached the top edge. `lib/share-card.js` steps the type down until the block fits, and the
rule is shared with the share-image function, because a card that fits in one and not the other is
worse than one a little small in both. A short title is untouched, to the pixel.

**The mark is the site's own.** `mark` on the site record is a file an owner uploads in Site settings
— an SVG or a PNG — and the card uses it as it is, untinted, because a logo has its own colours.
With none, the theme's `SiteMark` component is flattened to SVG at build time and drawn in the
site's **accent**, which is not the colour of the words beside it: SiteMark's stroke is
`var(--accent)`, so the mark is the site's red and the name is the row's grey. With neither, the
name stands on its own.
