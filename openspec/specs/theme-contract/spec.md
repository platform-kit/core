# theme-contract

## Purpose

What a theme is — the whole presentation of a PlatformKit site, replaceable piece by piece or whole — and what Movable Types, the default theme, promises: every page a reader or an admin sees, on the kit's design rules, with every component reachable by name.

## Requirements

### Requirement: A theme is a manifest of named parts

A theme SHALL be a package whose `theme.js` (reached as `<theme>/theme.js`) exports a manifest: its entry, its design stylesheet, where its default strings live, what its phone probe lets run to the edge, and — as the kit reads them — its pages and routes, its app tabs, its landing section types and skins. Its components SHALL be the `.vue` files under its source, registered by file name, and every name SHALL be unique across the theme — the kit refuses a theme where two share one. The kit's Vite plugin SHALL answer every import that lands on a theme component a site overrides with the site's file, however the import is written (a package specifier, a relative path, the `@/` alias), so a theme's own imports need no indirection and an override reaches every use; an import from the override itself SHALL get the original, so a site can wrap a component as well as replace it.

#### Scenario: two components of one name

- **WHEN** a theme has two `.vue` files of the same name in different folders
- **THEN** the kit refuses to load the theme, naming both

Verified by: `loadTheme` in `packages/kit/build/theme.mjs`

#### Scenario: every import of an overridden component

- **WHEN** a site overrides a component and the theme imports it by package specifier, by relative path and by the `@/` alias
- **THEN** all three resolve to the site's file, and the same import from the site's file resolves to the theme's original

Verified by: `packages/kit/build/overrides.test.mjs` in `npm test` — every component of the theme overridden by a stub, each resolved the three ways through the real plugin on a Vite server; and on 2026-09-17 a wrapping override of `SiteClose` seen at the foot of /store in dev and found in the production bundle

### Requirement: Movable Types is complete and switchable

The default theme SHALL cover every module's pages and components — the layout, the landing sections and classic skins, the library and reader, the store and bag, the pricing sections, the `/app` shell and its tabs, the quiz screens, the support widget, the auth modal, the admin's screens — and SHALL render nothing for a module that is off.

#### Scenario: the demo in both themes' states

- **WHEN** the demo runs with every module on, and again with the instrument, print and store off
- **THEN** every route that remains renders without a missing component, and the phone probe is clean in both

Verified by: the kit's CI (`build/phone-probe.mjs` against the demo)

### Requirement: The design rules travel with the theme

The theme SHALL carry the design-rules spec — one design, palettes as looks, the phone's gutter, one
motion, nothing pops, books as objects, the screenshot rule.

A **look** SHALL be accomplishable with as little as a palette: colours alone SHALL be enough to
make a site look like itself, because the design they colour is shared. That is a floor and not a
ceiling — a look MAY carry more, and a **site** SHALL remain free to shape its appearance by every
mechanism the theme offers: its own palette, replacing any theme component by name, skins, sections
of its own, its own stylesheets. Supplying a palette SHALL NOT be the only way it may do so.

**The theme SHALL ship a palette of its own**, and a site that declares none SHALL wear it: the
css imported, the theme's name reported as the default look, and no look switcher offered, since a
switcher offers what the SITE declared. The theme's palette and a site's own are LAYERS rather than
alternatives — a site that declares one overrides the theme's rather than replacing a thing that
was not there. Before the theme shipped one, a site that declared none imported no palette at all:
every token fell through to an undefined custom property and the landing's button drew its text in
the colour of its own background.

#### Scenario: a site's look

- **WHEN** a site adds `looks/<name>.css`
- **THEN** the theme wears it with no rule of its own changed

Verified by: `design-rules`

#### Scenario: a palette alone is enough

- **WHEN** a site supplies colours and nothing else
- **THEN** it looks like itself throughout, because the design those colours paint is the theme's and is shared

Verified by: `build/theme-look.test.mjs`; the root site, which supplies a palette and little else
(the demo and sites/brochure supply none at all and wear the theme's, which is the other half of
the same claim)

#### Scenario: a site that supplies no palette

- **WHEN** a site declares no look at all
- **THEN** it wears the theme's own, is told that is the default, and offers no switcher

Verified by: `build/theme-look.test.mjs` (the real plugin, a config with no looks and one with its
own); `sites/brochure` and `sites/demo` in a browser, both schemes

#### Scenario: a site changes its appearance by more than a palette

- **WHEN** a site replaces a theme component by name, registers a skin, or ships a stylesheet of its own
- **THEN** each takes effect, and none of them is refused for not being a palette

Verified by: `kit-extension-model` (overrides by name), `page-sections` (skins), the demo's `/sections`

### Requirement: The theme is a working site missing only its content

The theme SHALL render correctly with no site palette at all: it SHALL ship a default look, and a
site that registers none SHALL wear it. A site that registers one SHALL override it. The theme's
default and a site's own are layers, not alternatives — the existence of the site mechanism SHALL
NOT be read as the theme having no defaults.

#### Scenario: a site with no palette of its own

- **WHEN** a site registers no `looks` and renders any page the theme draws
- **THEN** it wears the theme's default look, and every colour resolves — no element draws its text in the same colour as its own background

Verified by: `build/theme-look.test.mjs`; the static lane against `sites/brochure`, which registers no look; pixels of its landing page in both themes

#### Scenario: a site with a palette of its own

- **WHEN** a site registers `looks: { <name>: { css } }`
- **THEN** its own palette is worn and the theme's default is not, and `LOOKS` offers only what the site declared

Verified by: `build/theme-look.test.mjs`; the ROOT site, which registers `classic` (the demo registers none at all and the docs site names the theme's default by name, so neither is an example of this)

### Requirement: A default palette is complete

The theme's default look SHALL define every colour token the theme's own stylesheets and components
read, in both the light and the dark scheme. A token the theme reads and the default does not define
SHALL fail the build, naming the token and where it is read.

This is what makes "the theme works" checkable rather than a matter of opinion: an incomplete
palette does not look wrong in review, it looks wrong on one page nobody opened.

#### Scenario: a token the theme reads and the default does not define

- **WHEN** the theme's CSS reads `var(--x)` and the default look defines no `--x`
- **THEN** the build fails, naming `--x` and the file that reads it

Verified by: `build/theme-look.test.mjs`, proved by deleting a token from the default and watching it fail

#### Scenario: the dark scheme is as complete as the light

- **WHEN** the default look defines a token for the light scheme
- **THEN** it defines it for the dark scheme too, unless the token is deliberately shared

Verified by: `build/theme-look.test.mjs`; pixels of the demo's `/sections` in both themes
