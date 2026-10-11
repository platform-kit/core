# design-rules

## Purpose

The rules every reader-facing surface keeps whatever it is for — the gutter on a phone, the one measure, the one motion, the site's own words and colours — so that a new surface is judged against them before it is shown, and a change that breaks one is refused at verify rather than found by James on a phone.

## Requirements

### Requirement: A phone keeps its gutter

Every page SHALL keep a gutter of at least 16px on both sides at 390px wide: no text of the page's own and no card (a rounded box) touches the screen's edge, and the document is never wider than the screen. A horizontal rail's cards leaving the page, the landing's decorative blobs and glows, and the support widget are the only things that may cross the edge.

#### Scenario: no card at the edge

- **WHEN** any public route, and the signed-in app pages, are rendered at 390px
- **THEN** `node build/phone-probe.mjs --as member@example.com` reports every page clean (no overflow, no card at the edge, no text at the edge)

#### Scenario: a card is never the measure itself

- **WHEN** a bordered or filled card is placed on a page
- **THEN** it sits inside a `.wrapwide` (or `.wrap`) container and never carries that class itself, so its border keeps the gutter

### Requirement: One measure

Every content surface SHALL share the site's measure (1120px, a 28px gutter, 20px under 700px), and a section under the landing's root SHALL keep that gutter too.

#### Scenario: a section under the landing's root

- **WHEN** a `section.wrapwide` is rendered inside `.lproot` at 1000px or 390px wide
- **THEN** its text starts at the gutter, never at x = 0

### Requirement: Words live in markdown

Every reader-facing string — headings, labels, placeholders, empty states, the visible labels of aria attributes — SHALL be authored in markdown under `content/` and read at runtime; a literal English string in a component is a fault.

#### Scenario: a new string

- **WHEN** a component shows a new string
- **THEN** it reads it from a `content/app/ui/*.md` record (or an i18next catalog) and no literal remains in the template

### Requirement: Colour comes from the look

A component SHALL read its colours from the look's tokens; a colour that is not a token is a rule owed to every look. Inside the support chat the site's accent SHALL NOT appear except on the sign-in button, because red reads as an error there.

#### Scenario: the chat in both themes

- **WHEN** the support widget is rendered in light and dark themes
- **THEN** notes, badges, ticks and bubbles are ink on paper, and only the sign-in button wears the accent

### Requirement: One motion

The support widget SHALL use one easing curve (`cubic-bezier(.2, .8, .2, 1)`) for everything that moves, and every motion SHALL be off under `prefers-reduced-motion`.

#### Scenario: reduced motion

- **WHEN** the widget is opened with `prefers-reduced-motion: reduce`
- **THEN** the panel, the card, the lines and the strips appear without animation

### Requirement: Books stand as objects

Wherever a book stands for itself it SHALL be `Book3D` wearing its printed softcover, never a bare image in a shadowed box, and the space it stands in SHALL leave room for its shadow (a scrolling rail wears padding and a matching negative margin).

#### Scenario: a book in a rail

- **WHEN** a rail of book cards is rendered
- **THEN** no book's shadow is cut flat at the rail's top or bottom, and on a phone the rail runs to the screen's edge so a card leaves the page rather than being cut mid-page

### Requirement: Nothing pops in

The header SHALL show nothing that depends on who is here until the session, the role and the entitlements are known, then show all of it together.

#### Scenario: a slow database

- **WHEN** the page loads signed in and the profile and entitlements reads take a second
- **THEN** the header's buttons are invisible until both have answered, then fade in as one, with the chat and bag buttons already in place

### Requirement: UI is looked at before it is shown

A change to anything a reader sees SHALL be rendered and looked at — every state it changed, both themes where the colour matters — before it is reported done.

#### Scenario: reporting a visual change

- **WHEN** a task changes a template or a stylesheet
- **THEN** its verification names the screenshots taken (with Playwright against the dev server) and what they showed; a passing build or a DOM probe alone is not verification

### Requirement: Placement in PlatformKit

**Module switch:** — (the theme's).

**Layers.** theme: every rule. site: its look only.

**Extension points this needs:** the phone probe's allow-list and the design tokens' names from the theme manifest.

**What the kit's module leaves to its comparable, on purpose:** —.

This capability SHALL land in the layers above, SHALL be switched by its module, and SHALL expose the extension points named; a site SHALL keep its side as registrations, never as patches.

#### Scenario: a second theme

- **WHEN** a second theme
- **THEN** it carries its own design-rules spec and the probe reads its allow-list

Verified by: the kit's CI against the demo, and the representative site fixture remains visually unchanged after the change

### Requirement: The header fits what it is carrying

The header SHALL decide what to draw by measuring what it needs against the room it has, and SHALL NOT
decide it by a width written into the stylesheet.

It SHALL step down in order until it fits: the search pill becomes the icon it already is on a phone;
then the links and the call to action go behind the menu. Items that do not fit SHALL go into the menu
in the order they were written, and SHALL NOT be drawn over one another or clipped mid-word at any
width.

It SHALL measure again whenever what it carries changes — the window, the session settling, a module's
icon arriving, a webfont landing — and the stylesheet's own breakpoints SHALL remain as the floor,
because a prerendered page is read before any of this runs and a phone must be right in the first
frame.

**Intent.** Every version of this was a number — 700, then 1024 and 900, then 1320, then a count of
items — and each was a guess about a different site. How wide this row wants to be is the site's name,
the words it chose for its links, how many modules are on and the typeface it picked in Settings; a
site that chooses a wide heading face breaks a fixed breakpoint the moment the webfont lands. The 1320
attempt is the instructive one: it fixed 1280 and left 1440 broken, because the row is capped at 1120px
— past about 1176 the viewport grows and the box does not, so whether a thing fits stops being a
question about the window.

#### Scenario: a site adds links

- **WHEN** a site's header holds more than fits
- **THEN** nothing overlaps and nothing is clipped at 1600, 1440, 1280, 1200, 1100 and 1000 — the pill collapses first, then the links go to the menu

Verified by: a probe measuring the row's needed width against its room at each of those widths, on the demo and on a site; the header screenshotted at 1440 and 390, light and dark

#### Scenario: two sites, two answers

- **WHEN** one site has four links and another has six
- **THEN** each keeps the search pill exactly as long as its own row has room for it, with no number changed anywhere

Verified by: the same probe against `sites/demo` and the root site

#### Scenario: the type changes

- **WHEN** a site picks a wider heading face in Settings and its webfont lands after first paint
- **THEN** the header measures again and steps down if it must, rather than drawing the pill under the first link

Verified by: the header screenshotted on a site whose heading face is changed, before and after the font loads

### Requirement: A palette is complete or it is not a palette

Every look — the theme's default and a site's own — SHALL define each colour token the stylesheets
that will read it actually read, in both schemes. The existing rule stands beside it: a rule that is
not a colour goes in the one design, never in a look; a colour goes in every look, never in the
design.

The reason this is a rule and not a habit: an incomplete palette does not look broken in review. It
looks fine on every page somebody opened and wrong on the one they did not. The theme shipped no
palette at all for months and the fault surfaced only when a fixture's landing page drew a button
with its text in the same colour as its background.

#### Scenario: a look missing a token the design reads

- **WHEN** a look is checked against the stylesheets that read it
- **THEN** a token read and not defined fails, naming the token and the file that reads it

Verified by: `build/theme-look.test.mjs`

#### Scenario: a site's own look is held to the same bar

- **WHEN** a site registers a look of its own
- **THEN** it is checked for completeness exactly as the theme's default is

Verified by: `build/theme-look.test.mjs` against the demo's and the docs site's own looks
