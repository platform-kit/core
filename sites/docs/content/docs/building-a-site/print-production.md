---
title: Print production
description: From a book's block to files at the printer — the editions, the typesetting, the covers, the EPUB, the printers behind one shape, the registry, and the store's pictures.
order: 57
sources:
  [
    packages/kit/supabase/schemas/44-print-jobs.sql,
    packages/kit/build/print-jobs-db.test.mjs,
    packages/kit/build/suppliers.test.mjs,
    packages/kit/build/print.mjs,
    packages/kit/build/print,
    packages/kit/src/lib/print,
    packages/kit/theme/src/components/admin/pdf-pages.js,
    packages/kit/supabase/functions/print-render,
    packages/kit/build/models/core/print.mjs,
    packages/kit/supabase/functions/_shared/suppliers,
    packages/kit/supabase/functions/_shared/print.ts,
    packages/kit/theme/src/components/Book3D.vue,
    packages/kit/theme/src/components/admin/PrintAdmin.vue,
    packages/kit/build/print/typeset/interior.js,
    packages/kit/build/git-push.mjs,
    packages/kit/supabase/functions/print-order,
    packages/kit/supabase/functions/print-webhook,
    packages/kit/supabase/functions/lulu-webhook,
  ]
reviewed: 2026-10-29
---

Editors' view: [Print editions](/content/docs/running-a-site/selling/print-editions). This page is the machinery.

## The printer seam, and what holds it

A printer is one file behind one shape, and the claim that goes with it is that **nothing outside
`_shared/printers/` chooses a printer by name**: a new one is that file plus its id in
`PRINTER_IDS`. `build/printers.test.mjs` holds both halves — the shape (every id answers the whole
interface, makes only our formats, speaks all three shipping words, maps its own status words into
our six and nothing else, and `product()` is pure with a minimum page count) and the seam (a sweep
for a quoted printer id anywhere else).

It found four places that named one. The book's print-block schema in `velite.mjs` wrote the list
out again, so a fourth printer could be added and then refused by the compile for any book that
named it; the enum is `PRINTER_IDS` now. And three sites — the ledger writing a print order, the
proof order, and the status refresh — read `provider ?? 'lulu'`, which would have sent a book set
at Bookvault to Lulu, or read a status back from a stranger's job id and written it over this
order. **There is no fallback**: an order whose edition names no provider fails with a line saying
what to run, which is retryable, where a guess bills the wrong account.

The two webhook paths still name Lulu and are a listed exception rather than an oversight: Lulu is
the only printer that posts to a url registered once, Mixam is given its callback per order, and
Bookvault sends none. A call is never believed: the job it names is read back from the printer. A
mocked printer (no keys, or `PRINT_MOCK`) has nobody to call it and moves its pretend job a step on
every read, so its webhook is ignored.

> **A printer is a SUPPLIER, and the interface says nothing about books.** A supplier makes a
> VARIANT out of ARTEFACTS: `chosen` is what the buyer picked, `artefacts` is whatever the kind
> produced for it — a book's page count and print files, a garment's artwork. The interface used
> to take `pages` and `files` by name, which meant only a printer could implement it. Two
> suppliers that are not printers prove the seam: the shop’s own **post room**, which makes
> nothing and waits for a person to say it has gone, and a **download**, which is finished the
> moment it is paid for. See [Commerce internals](/content/docs/building-a-site/commerce-internals).

## One seam, two compilers

Typst is behind **`build/print/typeset/compiler.js`** — `create`, `pdf`, `svg`, `query` — and nothing else under `build/print/` imports it. There are two drivers:

| driver | where                                            | what it is                                                                                                                                                                                           |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node` | a machine with a build box                       | `@myriaddreamin/typst-ts-node-compiler`, a native binary of about 44 MB — an optional peer, so a site with the print module off installs none of it                                                  |
| `wasm` | the administrator's browser and an Edge Function | the same compiler built for WebAssembly, because a cloud-only site has nothing else: the browser sets the interior, the function the covers. An ordinary dependency, since the admin bundle needs it |

They are the same program built twice, and that is the point. An **edition** is a hash of the source, the templates and the trim, and `print.json` says which file a printer has — so if the two paths could diverge, nobody could tell which edition a printed book actually is. `PRINT_DRIVER=wasm` sets a book with the other one, and `build/print-parity.test.mjs` holds them to the same bytes.

The seam exists so the two can be held to each other, and a measurement decides where each piece runs. A book's interior is compiled in one step: it is typeset as one document, so its contents page and highlights index can name every page, and there is no piece planner or PDF merge. Natively that compile is quick, but as WebAssembly in an Edge Function a 164-page book's interior took **1.74 seconds** of the 2 seconds of CPU a request gets, before any of the work around it. A longer book could never be set there, however often it was retried. So **the function does not compile the interior; the administrator's browser does** (`build/print/typeset/interior.js`), with the same WebAssembly and the same type, and the function makes the covers and the EPUB, which fit.

**A set is a job that outlives its request** (`print_jobs`, `supabase/schemas/44-print-jobs.sql`): a row per set, leased to one worker at a time, with each step written down as it finishes — the interior, each cover, the EPUB. A job whose edition has no interior yet **waits** (`state: 'waiting'`): the sweep and the lease leave it alone, and a second set of the same book joins it. The browser asks the job `{ job, interior: 'handover' }` for the source, the templates, the type and the binding rule as signed addresses, plus a signed address to upload to. It compiles, uploads the PDF and hands the job back with `{ job, interior: { edition, pages, pad, where, marks } }`. The function counts the pages off the file itself and holds the blank leaves to the binding rule before it takes the interior, and refuses one that is not what it says. A taken interior is kept beside the PDF (`interior.json`), so any later set of that edition takes it back and never waits. A set cut off part-way after that leaves its lease to lapse; a sweep every minute (`print-jobs`, owned by the print module) asks `print-render` again with `{ job }`, and the next worker takes the finished steps back from the bucket and carries on. The caller gets the same answer when a set finishes in its own request, with the `job` it ran as, and asks `{ job }` for it when the answer was lost. `{ job, cancel: true }` stops a set at its next step (a waiting one at once) and removes the files it made for an edition the store does not sell. A job that cannot finish is failed with its reason after five attempts.

### What a cloud-only site does not get

Two things in print production need a native program, and a function has neither. Both degrade the **listing** and never the book — an edition set without them is the same edition, byte for byte, with the same id.

|                                                               | on a machine                                                                                                                        | in a function                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the pages shown on the listing, and the cover the store draws | photographed from the printer's own PDF by pdf.js in a headless Chromium; the cover written straight out as SVG by the same compile | **drawn by the administrator's browser**, from the PDFs the function made, at the moment an edition is set — and posted back against that edition. There is no Chromium in a function and no way to put one there; there is one in front of whoever pressed the button |
| the paperback's picture, sized for the printer                | `sharp`                                                                                                                             | Storage's own image transform, which does the same two operations — honour the orientation, cap the height — and is part of Supabase                                                                                                                                   |

The page pictures are skipped **deliberately and with a line that says so**, not caught as a failure. A machine that _has_ a browser and still cannot photograph a page is a fault and is warned about, because there they were expected. `PRINT_NO_SHOTS=1` skips them anywhere.

Deploy generation is separate and opt-in: only `PRINT_BUILD=1` runs the print step that renders and uploads editions and updates the print index and printer registry. When a deploy leaves generated art absent, `Book3D.vue` layers the ordinary markdown cover beneath the printed cover art, and the product gallery uses bounded Vue/CSS chapter previews where page images are missing. Generated page images remain preferred.

## Setting a book with no machine: `print-render`

`supabase/functions/print-render` is the whole of print production in an Edge Function, for a site whose backend is Supabase and nothing else. `POST { book, contents }` with an administrator's JWT; it answers what it set, or why it could not.

What it does, in order: reads the book and its companion from `public.content` **through `entry.js`** — the one adapter, so the function sees the same book the build does; reads the print words through the store, so a site's own `library.md` wins over the theme's; sizes the paperback's picture; typesets with `build/print/typeset.mjs` unchanged; works out what the printers will bind (`padFor`, the shared rule) and takes the interior back, or waits for the administrator's browser to set it (above), with the templates (`_shared/print/templates.json`) and the type from the `print` bucket; quotes the printers and draws a cover per printed format, and per cloth × foil for a linen, each to that printer's own dimensions; and stores everything under `<slug>/<edition>/` — the same names the native path uses.

The edition id is the shared rule (`build/print/edition.mjs`), which is the claim worth stating plainly: **the function and the build give the same book the same edition.** The Golden Key comes out as `25e674ffcaa1d9cf` either way, with a byte-identical `interior.typ`. `build/print-cloud.test.mjs` runs the function against the stack and compares both, and when the ids differ it names the part that moved — because the hash has fifteen parts and guessing which one is a bad afternoon. `PRINT_PARTS=1` prints the same list on the build side, and a call with `parts: true` on the function side; a call with `typ: true` keeps the Typst sources in the bucket beside the PDFs, as `--typ` does on a machine.

It finishes the job: the printers validate the files from the bucket and quote them, a printer that keeps a title is asked for ours by SKU before one is ever made (and what is made is written to the bucket's `<slug>/registry.json` and to `print.json` the same moment, since a setup fee paid twice is money gone), the EPUB is made from the same words by the same module, and `print.json` is written **through the store** — a file in a checkout, a row of `public.content` here, and the code does not know which. A cloud render carries forward the store art and the page pictures a machine made for the same edition rather than emptying a gallery it cannot draw itself.

One rule decides whether a printer is asked anything at all: **can it fetch the file?** A printer downloads the signed url from its own machines, so what matters is not whether this process can open it but whether a stranger could. A local stack's `127.0.0.1` is obviously private; less obviously, a function signs urls against its own `SUPABASE_URL`, which locally is the stack's _inner_ host (`http://kong:8000`) — not loopback, so a check written against loopback waved it through and Lulu answered "received a None status code" after a timeout. `reachableToPrinter` is therefore positive rather than a blacklist: a public host has a dot in it and is not a private address. Where it says no, the files are kept and costed and nothing is checked, given a title or submitted.

**What it cannot draw, and who draws it instead.** A listing needs pictures — the cover sheet the
shelves wear, and three pages of the interior — and both want a raster or an SVG out of a PDF. The
function has Typst and no browser, so neither is made there.

The cover is the surprising half. On a machine both the printer's PDF and the store's SVG come out of
the same compile, because Typst writes SVG with every glyph as a path. **The WASM compiler cannot**:
`svg` is on the seam and the web build answers `Unsupported fmt`, since SVG in typst.ts belongs to
the renderer rather than the compiler — a second wasm module, and a second megabyte in a function
already fetching ten of type per worker. Reaching for `c.svg` here is the natural mistake and it
fails at the moment an edition is set.

So the function hands out what a browser needs and takes back what it drew:

- **going out**, with the answer: `where` and `marks` — the document's own account of where each
  chapter opened and each highlight fell, read back by the same Typst query the build makes
  (`readback`, its own import-free module). Without it the browser would have to infer a chapter's
  page from the text it can see. Plus `folder`, where the PDFs are, and `covers`, what they are called.
- **coming back**: `POST { book, contents, edition, shots, art }` — the pictures, uploaded to the
  public `content-assets` bucket, recorded under the same cover keys the dimensions and the printers
  use, so `coverFor()` finds a browser's raster exactly as it finds a machine's sheet. Each is recorded at
  the public address a reader's browser fetches (`VITE_SUPABASE_URL`), never the functions runtime's own
  name for the gateway, which no browser outside Docker resolves.

It is recorded **against the edition**, and refused for any other. A page number means nothing
without the exact text it came from: change a word and the openers fall elsewhere, so a picture of
page 41 of the old edition is a picture of the wrong page. Pressing Save & render between the set and
the draw is refused with both ids named.

### Set the editions, from the live admin

The admin's print actions — `render`, `save`, `set`, `quote`, `pdf` — all run in the cloud. The model does not choose a renderer: the **caller hands it one**. `ctx.editions` (given by the admin's Edge Function, absent on a machine) is `{ render(slug, { draft }), file(book, edition, name) }`, and where it is absent the machine's path runs as it always has. That is why `build/models/core/print.mjs` can be part of the pipe at all — the module a bundler cannot follow is only imported when nothing else was offered.

A render is a separate invocation of `print-render` on purpose: setting a book is most of a CPU budget, and the admin answers many other things in the same worker. When a save, a render or a set comes back with interiors waiting, the admin function passes them through and the Print editions page sets each one in the browser, saying which step it is on (the theme's `orders` words, group `editions.interior`), then asks again. The second answer takes the interiors back from the bucket.

**A draft buys nothing.** The admin renders on every save so the editor can turn the pages, and a title at a printer that keeps one costs a setup fee — so `draft: true` makes the files and the quotes but stops short of the registry and of `print.json`. Only Set the editions does the real thing.

A rendered file is in the print bucket rather than on a disk, so `pipe.fileUrl(col, action, payload)` answers the dev server's GET on a machine and, in cloud mode, a blob made from the action's bytes. The page preview and the EPUB link are therefore there either way; before this they were simply absent in the live admin.

Two things have to be in place before it will work at all, and it says which is missing rather than failing obscurely:

- **The type.** An Edge Function has no fonts. The deploy's `print-type` step uploads them to the `print` bucket (`node packages/kit/build/print/templates.mjs --fonts` does it by hand — a local stack loses them on every `supabase start`), and the function refuses to set anything without them. A book set in a fallback face is wrong in a way nobody notices until it is printed.
- **Storage's image transform**, for a paperback only — its front _is_ the e-book's picture, and there is no `sharp` in a function. It is a Pro-plan feature on the hosted platform, and the kit's `config.toml` template turns it on locally (`[storage.image_transformation]`). The transform keeps the original's format, so the picture is named by what its bytes are (PNG, JPEG, WebP or GIF), never by its file name: a WebP saved as `.png` is still set. Without it the paperback is **left unset and said so** (`incomplete` in the answer), never drawn blank: a cover without its picture would be a different sheet under the same edition id, which is the one thing this whole path exists to make impossible. A hardcover is set in type and needs none of it.

## The block and the offers

A book's `print:` block (its schema is in `velite.mjs`; `lib/print-offers.js` reads it as `printSpec`; `build/print/block.mjs` writes it as a block, the rest of the file byte for byte, refusing an option a printer does not have) yields the offers: one store page per book, one sku per format (`<slug>-<format>`, `formatOffers` → catalog.json, kind `print` for what ships and `download` for a file), the print offer hidden from listings when the book also has an unlock. A format's price is as written, or a markup over the costliest quote among the contents the buyer may choose, rounded up to the next $5.

## `build/print.mjs`

`--book <slug>` | `--all`; `--local` renders only; `--force` re-renders; `--dry` says what would be set; `--typ` keeps the Typst source; `--contents` one edition; `--proofs` lists set editions not yet proofed. A book with `fullText: false` has only its summary edition, and a block or `--contents` asking for another is refused by name. For every contents the block offers:

1. **Typeset** (`typeset.mjs` into `book.typ`, compiled through the typesetting seam, `build/print/typeset/compiler.js`; the fonts under `build/print/fonts`): a blank first leaf, the title on a recto, the colophon, the contents on a recto, the publisher's note (two-part editions), the introduction, each chapter on a page of its own (a recto in a book of long chapters, either side in a book of short ones; the first of each part on a recto) with its companion after it on a tinted ground, every mark as one pale yellow highlight, gathered at the back one run per part in the heading face with each line's page beneath. One page rule for the whole book, set before the front matter; running heads and numbers suppressed by physical page on openers and skipped versos; the count padded even. Hard breaks kept for verse and flowed where a book was typed with one at every line; a stack of short unpunctuated paragraphs set as verse; asterisks as a dinkus; a line in capitals as a subhead; OCR faults fixed in the markdown, never worked around in the typesetter. The printer binds 24 to 800 pages; a short book is padded with blank leaves.
2. **The cover** (`cover.typ`) to each printer's dimensions: a paperback's front is the book's own picture (the cover field's address resolved to its file by `build/assets.mjs`, decoded by sharp, cropped as the shelves crop it, never letterboxed) with the mark and the edition line on a scrim; a hardcover's is set in type on the cloth — the title in the foil's colour over an ornament, the author in spaced capitals, the mark at the foot; the spine says Title · Edition (`spineWords`: 25 characters, one rule everywhere); the back the companion's insight over the blurb; a jacket's flaps. Per cloth × foil the buyer may pick, filed under `<format>-<printer>[-cloth-foil]`; for a format stamped with our own foil, the foil layer beside it. Every cover also as SVG for the store.
   The edition's own words — the eyebrow, the edition line, the part names, the highlights page — are
   `## print / ### book` in the **library** strings scope, read through `build/print/words.mjs` the
   way every other scope is read: the theme’s defaults with the site’s merged over them, through the
   store rather than off the disk, so the admin's server reads them in cloud mode too. There is no
   English in that module and no site's name in it; a site that says nothing gets the theme's word.
3. **The EPUB** (`epub.mjs`: EPUB 3 from the same words, one XHTML per chapter, the key insights after each, the highlights at the back with links, the site's cover art).
4. **The pictures** (`raster.mjs`, pdf.js in the build's headless Chromium at 144 dpi, one crop box for every page): the pages `pages.mjs` picks from what the document says about itself — the fullest chapter opening, the same chapter in the other text, the page with the most highlights — into `public/print/<slug>/<edition>/`.

   **The measuring and the crop are shared, because there are two browsers.** How much text each
   page holds (a full page told from an opener) and the type area of the whole file (ONE box for
   every page — a box per page gave every picture its own size) are `src/lib/print/pdf-shots.js`:
   the build's headless Chromium inlines that file into the page it drives, and the administrator's
   own browser imports it directly. A cloud-only deployment has no build box and never will, so the
   pictures are drawn at the moment an edition is set, by the browser that already has the interior
   PDF in hand — and they have to be cropped by the same rule as a machine-set book's or a gallery
   would show the difference.

5. For that page count, per printed format: the printer (named, or the cheapest quoted), the quote, the check, and for a printer that keeps a title, the title.

An **edition** is the hash of the source, the templates, the trim, the bindings and colours, and the paperback's picture byte for byte, so nothing is set twice and a changed word is a new one. Its files go to the private `print` bucket as `<slug>/<edition>/{interior.pdf, cover-<key>.pdf, book.epub, manifest.json}`; `content/store/print.json` (committed) indexes every book's editions — pages, printers, covers, art, shots, titles — which the store reads and catalog.json carries as `editions` for the functions. **A change to the typesetting is checked by looking at every page** (`pdftoppm` + `montage`), never by a page count.

## The printers behind one shape

`_shared/printers/{lulu,mixam,bookvault}.js` — plain JavaScript on fetch alone, so the build (through `build/print/printers.mjs`, which binds `process.env`) and the functions run the same file: `configured()` / `mock()`, `options(format)`, `product()` (pure: the printer's descriptor for a format and its options), `dimensions()`, `quote()`, `validate()`, `register()` (a printer that keeps a title), `order()`, `status()` + `statusOf()` (its words onto ours), `webhook()` + `ensureWebhook()`, and `levels` (our shipping words in its). `index.js` lists them and `providersFor(format)` says which make a format with keys. A new printer is one such file and its name in `PRINTER_IDS`. Every printer is mocked by `PRINT_MOCK=1` (or its own `<ID>_MOCK`), and by having no keys. A printer fetches a book's files by their signed url itself, so against a local stack's bucket a real account can size and quote a book but never validate or print it.

## The registry

A printer that keeps a title (Bookvault: one per book, contents and format, SKU `dl-<slug>-<contents>-<format>`, made once for a fee) is asked for it by SKU before one is ever made, and what is made is written the same moment to the bucket's `<slug>/registry.json` and to print.json's `titles` — and, with `PRINT_COMMIT=1` (the deploy sets it), committed and pushed through `build/git-push.mjs` — so no machine and no deploy can pay a setup fee twice. A register the bucket cannot record is refused before it is made.

## The admin's page

`PrintAdmin.vue` at `/admin/print[/<slug>]`: the grid, the five panels, the book to turn (`pdf-pages.js` draws each page with pdf.js; `page-flip` turns them). **Save & render** writes the block and renders every edition locally (`printBook(slug, { local: true })`); **Set the editions** does the real thing. The print editions are the `print` model of the admin's registry (`build/models/core/print.mjs`): `list` answers every book with its block, the set editions and the drafts, and its actions are `save` | `render` | `quote` | `set` | `proofed` and `pdf` (a rendered file streamed, by the `action` endpoint's GET form).

## The book as an object

`Book3D.vue` draws a book wherever one stands — the shelf, the hub, the results page, the landing, the store's cards, the hero, the gallery — after filipz's "Animated 3D Book Collection": the cover on a back board, six leaves at the fore-edge that fan under the pointer with the cover in one motion, 2:3 wherever it stands, container-sized. Given a slug it wears the printed softcover's front panel from `printedArtOf` (`lib/book-art.js`) — the SVG the print build made — with the book's ordinary markdown cover underneath as a fallback if that art is absent. Never a stock mockup, never a flat picture of the jacket in its place.
