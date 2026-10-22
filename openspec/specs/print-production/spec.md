# print-production

## Purpose

How a printed book is made and fulfilled: the interior and covers typeset from the same words the site shows, editions hashed so nothing is set twice, printers as plug-ins behind one shape, the order sent the moment a sale lands and followed to shipped. The offer side — the block, the prices, the store page — is `print-editions`.

## Requirements

### Requirement: The interior is typeset by rules, never by hand

`build/print/typeset.mjs` and `book.typ` SHALL set every edition the block offers: a blank leaf, the title on a recto, the colophon, the contents on a recto, A Note on This Edition for a two-part book, then the body numbered from 1 — one page rule for the whole book; every chapter opening on a page of its own (a recto for long chapters, either side for short ones, the first of each part on a recto); running heads and folios suppressed on openers and skipped versos; hard breaks kept for verse and flowed for prose typed a line at a time; a run of short paragraphs set as verse, asterisks as a dinkus, a capitalised line as a subhead; every `==mark==` a pale yellow highlight and gathered at the back per part with page numbers; the companion after each chapter ruled and numbered, never orphaned; OCR faults fixed in the book's markdown, never worked around; the count padded even.

#### Scenario: a typesetting change

- **WHEN** `book.typ` or `typeset.mjs` changes
- **THEN** every page of one book's interior is rendered with `--local`, turned into sheets and read before any edition is set

Verified by: reading the sheets (by design, no automation)

### Requirement: Covers, jackets and foil

`cover.typ` SHALL draw each cover to the printer's dimensions: a hardcover's title-page design with rules on the cloth's colour, the paperback's front the e-book's own picture cropped as the shelves crop it — the file the book's `cover` address resolves to (`build/assets.mjs`, `media-library`), never one looked for beside the markdown — the spine saying what the foil says (the title and site-configured edition label, within the printer's character limits), the back the insight over the blurb, the jacket's flaps; a foil-only layer for a printer that stamps our artwork; every cover compiled to SVG for the store; the paperback's picture part of the edition's hash.

#### Scenario: a sharper picture

- **WHEN** a larger picture is put at the book's `cover` address
- **THEN** the paperback's edition is new and set again; the hardcover's is not

Verified by: `build/edition-id.test.mjs` — fourteen things that MUST move the id (a template, a word, the trim, the paper, the cloth, the foil, the printer, its options, the formats, the colours, the EPUB, the two jacket lines, and the picture) and what must not; the picture identified by its bytes rather than its name or its date, and the part ORDER pinned since the hash is a join

### Requirement: The pages on the listing and the EPUB

Three pages of the print file SHALL be drawn at 144 dpi, cropped to ONE type area for every page,
and carried in `print.json` as that edition's `shots`. Which three is decided from what the
document says about itself — the fullest chapter opening, the same chapter in the other text, the
page with the most highlights — and never by hand; `epub.mjs` makes an EPUB 3 from the same words
with the insights after each chapter and the highlights gathered.

The EPUB is made by every render, on every driver.

**The pages are drawn wherever there is a browser to draw them in, and by the same rule.** Drawing
them needs pdf.js, which needs a browser: on a machine that is the build's headless Chromium, and
on a site with no build box it is the ADMINISTRATOR's own browser at the moment they set the
edition. The decision — which pages, and the one box every page is cropped to — is a pure function
of what the document says about itself and what pdf.js reads off it, and both paths SHALL take it
from that one rule rather than each computing it. A page drawn either way is the same page.

**Shots belong to an edition.** Each set is keyed by the edition it was drawn from, so a listing
never shows a page of the book this one used to be. Where an edition has none the store draws what
it has — the book itself and the EPUB — and never an empty slide or a broken picture; a later
render fills them in without re-setting the edition.

#### Scenario: which pages

- **WHEN** an edition is rendered
- **THEN** its `shots` carry a chapter page, its counterpart in the other text, and the marks page, none chosen by hand

Verified by: `build/print-jobs.test.mjs` (the choice, over fixtures); `--dry` and the store's gallery locally

#### Scenario: the same page either way

- **WHEN** the same edition is drawn by the build's headless Chromium and by an administrator's browser
- **THEN** both choose the same page numbers and crop to the same box, because both read it from the one shared rule

Verified by: `build/print-jobs.test.mjs` (the rule under Node, against the pdf.js text content both paths hand it)

#### Scenario: an edition set by a function

- **WHEN** an administrator presses Set the editions on a site with no build box
- **THEN** the interior, the covers and the EPUB are set by the function, and their own browser draws the three pages and stores them as that edition's `shots`
- **AND** the admin says the pages were drawn, or says why they were not, rather than leaving it to be noticed

(This scenario is the one `print-on-demand` left saying `shots` is simply absent in the cloud. It is
the same case; the answer has changed.)

Verified by: the Print editions page in cloud mode, screenshotted; the store's gallery for that book

#### Scenario: an edition with no pages

- **WHEN** an edition carries no `shots` — a browser that could not draw them, or a render that did not
- **THEN** the product gallery shows the book and the EPUB with no gap where a picture would be, and never a page from another edition

Verified by: the gallery rendered with the shots removed from print.json — screenshotted, no gap

### Requirement: Printers are plug-ins behind one shape

Each printer (`lulu`, `mixam`, `bookvault`) SHALL be one module on fetch alone shared by the build and the functions: `configured`, `mock`, `options`, `product`, `dimensions`, `quote`, `validate`, `register`, `order`, `status` + `statusOf` (its words onto submitted · in_production · shipped · rejected · canceled · failed), `webhook` + `ensureWebhook`, `levels`; `PRINTER_IDS` is the only list; every printer is mocked by `PRINT_MOCK=1`, its own `<ID>_MOCK`, or having no keys; a printer that keeps a title (Bookvault) is asked by SKU before one is made and the registry is committed the same moment (`PRINT_COMMIT`).

#### Scenario: a new printer

- **WHEN** a printer module is added and named in `PRINTER_IDS`
- **THEN** the admin's Printers panel, `auto`, the deploy checks and the order path all know it with no other code

Verified by: `build/suppliers.test.mjs` — every id in `PRINTER_IDS` answers the whole interface, makes only our formats, speaks all three shipping words, maps its statuses into ours and nothing else, and `product()` is pure with a minimum page count; and no module outside `_shared/printers/` chooses a printer by name (the two webhook paths are the one named exception, since Lulu alone posts to a registered url)

### Requirement: A sale is an order, followed to the door

A paid `print` line SHALL become a `print_orders` row sent to its printer at once with week-long signed urls; against a local bucket a real printer can quote but never validate or print, and the function refuses to submit such a job; the printers' webhook (`print-webhook?provider=`, Lulu's registered at deploy, Mixam's given per order, Bookvault polled through `print-order`) reads the job back — never trusting the body — and moves the row; shipped sends the parcel email with tracking; the admin's Print orders page follows every row live with resend and check.

#### Scenario: a webhook with a forged body

- **WHEN** a request hits `print-webhook` claiming a job shipped
- **THEN** the row moves only if the printer's own API says so

Verified by: `build/suppliers.test.mjs` — every printer handed null, an empty body, a stranger’s JSON and a plain string yields no job id, so `print-webhook` has nothing to look up and never trusts the body

### Requirement: The store art is gitignored and drawn on every box

The covers' SVGs and the pages' JPEGs SHALL be drawn by every render that has what it takes to draw
them — on a machine, by deploy's included, into `public/print`, and never committed; a book already
set on a box that has never rendered it has its art redrawn from the same source without anything
sent to a printer.

Where a render has no browser the covers' SVGs are still drawn (Typst writes them) and the pages'
JPEGs are the administrator's browser's to draw, as above. The art is a listing nicety either way:
the edition's id is the same with it and without it, so art that arrives late is never a new
edition.

#### Scenario: a fresh deploy box

- **WHEN** deploy runs `print.mjs --all` with every edition already in the bucket
- **THEN** the art exists under `public/print` before `vite build` and no printer is called

Verified by: NOT VERIFIED on a deploy box

#### Scenario: art is not part of the edition

- **WHEN** an edition is rendered with the page pictures and again without them
- **THEN** the edition id is the same both times

Verified by: `PRINT_NO_SHOTS=1 npm run print -- --book the-golden-key --local` → the same edition id

### Requirement: Placement in PlatformKit

**Module switch:** print.

**Layers.** core: the pipeline (typeset, cover, EPUB, raster, quotes, orders, webhooks, statuses) and
the two drivers that run it. theme: `book.typ`, `cover.typ`, the fonts, the ornament — the printed
page is presentation, overridable. site: nothing but content.

**Extension points this needs:** templates resolved through the theme manifest; printers as plug-ins
already behind one shape; **the compiler behind one shape** (`typeset/compiler.js`: `compile(source,
inputs) → bytes`, `query(source, selector) → records`), so the same typesetter runs on the native
compiler and on the wasm one.

**What the kit's module leaves to its comparable, on purpose:** Blurb and Lulu's own tools: no
interactive layout; a change to the typesetter is checked by reading every page, never by a preview.

This capability SHALL land in the layers above, SHALL be switched by its module,
and SHALL expose the extension points named; a site SHALL keep its side as registrations, never
as patches.

#### Scenario: a site with its own print templates

- **WHEN** a site with its own print templates
- **THEN** the pipeline typesets with the site's `book.typ` and the store draws the site's covers

Verified by: the kit's CI against the demo, and the representative site fixture remains visually unchanged after the change

### Requirement: An edition is set the same way wherever it is set

An edition SHALL be identified by the hash of its inputs — the template version, the trim, the
bindings and colours, the exact text, and the paperback's picture byte for byte — and that hash
SHALL NOT depend on which driver set it. A machine and a function given the same book SHALL produce
the same edition id, and a printer holding a file from one SHALL never be sent a different file from
the other under the same id.

The typesetter, the templates, the fonts and the printers are one engine with two drivers. A driver
MAY differ only in *where the work runs* and in the best-effort artefacts named above; it SHALL NOT
fork a template, a hash input or a printer call.

#### Scenario: the same book, both drivers

- **WHEN** one book is rendered by `npm run print` and by `print-render`
- **THEN** the two editions have the same id, and the interior PDFs differ only in the metadata Typst stamps with the run's date

Verified by: `build/print-parity.test.mjs` (both drivers over one short book, hashes compared)

#### Scenario: a driver that would fork the engine

- **WHEN** a change puts a template, a hash input or a printer call on one driver and not the other
- **THEN** the build refuses it

Verified by: `build/print-parity.test.mjs` (the compiler seam is the only difference between the two entry points)

### Requirement: The compiler is behind one seam

Typst SHALL be reached through one module, `build/print/typeset/compiler.js`, exposing `compile`
and `query` over bytes, and nothing else in the pipeline SHALL import a Typst package. Two
implementations fill it: the native `@myriaddreamin/typst-ts-node-compiler` on a machine, and
typst-wasm in a function, the second fetching its `.wasm` and the theme's fonts from Storage on
first use and holding them for the worker's life.

#### Scenario: an import of Typst outside the seam

- **WHEN** a module other than the compiler seam imports a Typst package
- **THEN** the build refuses it

Verified by: `build/print-parity.test.mjs`

### Requirement: A book is compiled a piece at a time, because two seconds is the budget

A Supabase Edge Function has 256 MB of memory, 400 seconds of wall clock and **two seconds of CPU per request**, and a cold worker can spend much of that loading the compiler. Setting a book in the cloud SHALL therefore be a job that outlives any one request: a record per set, leased to one worker at a time, with each step written down as it finishes (the interior, each cover, the EPUB). A step already finished for the same edition SHALL never be done again.

A request cut off part-way SHALL leave its job to be carried on: a sweep every minute SHALL ask again for any job whose lease has lapsed, and the next worker SHALL continue from the finished steps. The caller SHALL get the set's answer when it finishes in its own request, and SHALL be able to ask the job for it afterwards. An owner SHALL be able to cancel a set: no further step runs, and the files made for an edition the store does not sell are removed. A job that cannot finish SHALL be failed with its reason after five attempts.

The interior SHALL compile in one step: the book is typeset as one document, so its contents page and its highlights index can name every page.

#### Scenario: a worker times out mid-book

- **WHEN** a set is cut off after its interior is finished and its lease lapses
- **THEN** the next worker finishes it on its second attempt, with the same edition and pages, taking the interior back from the bucket rather than compiling it again

Verified by: `build/print-jobs-db.test.mjs` under `platformkit test --e2e`

#### Scenario: a piece that will not fit in two seconds

- **WHEN** a step is cut off by its budget again and again
- **THEN** the job is not left running for ever: after five attempts it is failed, with its reason

Verified by: `build/print-jobs-db.test.mjs` under `platformkit test --e2e`

#### Scenario: an owner cancels a render

- **WHEN** an owner cancels a job
- **THEN** no further step runs and the part-written edition is removed from the bucket

Verified by: `build/print-jobs-db.test.mjs` under `platformkit test --e2e`

#### Scenario: a lease still held

- **WHEN** a second call reaches a job another worker holds
- **THEN** it leaves the job alone and says the set is running

Verified by: `build/print-jobs-db.test.mjs` under `platformkit test --e2e`

### Requirement: A cloud-only site can set an edition

A site with no build box SHALL be able to render, quote, validate and set every edition its books
offer, from the admin, with Supabase as the whole backend. The Print editions page SHALL show a
job's progress piece by piece and SHALL NOT offer an action that cannot be completed on that site.

#### Scenario: Set the editions in cloud mode

- **WHEN** an administrator of a cloud-only site presses Set the editions
- **THEN** a job is enqueued, the page shows it moving, and the editions land in the `print` bucket with their quotes, their titles and `print.json` written

Verified by: the demo in cloud mode, by hand, with a screenshot of each state

#### Scenario: the crop with no sharp

- **WHEN** a paperback's picture is cropped in a function
- **THEN** Storage's image transform does it, to the same dimensions the printer's cover asks for

Verified by: `build/print-cloud.test.mjs`
