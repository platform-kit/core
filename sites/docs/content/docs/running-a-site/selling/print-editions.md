---
title: Print editions
description: Putting a book on sale in print and as files — the block on the book, the Print Products page, setting the editions, proofs, the publisher's note.
order: 21
sources: [packages/movable-types/src/components/admin/PrintAdmin.vue, packages/movable-types/src/components/PrintOrders.vue, packages/kit/build/print.mjs, packages/kit/build/print/block.mjs, packages/kit/src/lib/print-offers.js]
reviewed: 2026-10-01
---

A book is sold in print — and as PDF and EPUB — by a block of settings on the book itself, edited on Sales → **Print Products**. There is no separate product file: the offers are derived from the book, one store page per book, one line per format.

## The index

Every book, with the state of its sale: each format on sale at what price (or why not), its contents, formats, cloth and foil (or "Choice"), pages, the printer's cost and the prices.

## The editor's panels

**Edition.** Which *contents* the buyer may choose — `parts` (Part One, the publisher's own edition: the whole book rewritten for today, chapter by chapter; Part Two, the original full text), `full` (the text alone), `summary` (the edition alone), `both` (the text, each chapter followed by its companion); the first is the default and every one is an edition of its own. The trim (6×9 or 5×8), the paper (cream or white), the default cloth and foil colours as swatches, a **spine title** (a shorter title for a long one, counted against the foil's 25 characters — the field refuses more), and whether the page mentions the book online.

**Formats & prices.** A row per format — softcover, hardcover, premium (cloth boards, foil, a ribbon, sprayed edges), pdf, epub — each with its switch and either a **price** as written or a **markup** in dollars over what its printer charges to make one copy, rounded up to the next $5 (the markup sits on the costliest contents the buyer may choose, so it is a floor). The hardcover's cloths and foils: one, or the buyer's choice among several (a jacket is rendered for each combination). What comes with a printed copy (the files). The rights line — without which nothing is set or sold. The offer's key, read-only.

**Printers.** For each printed format, a printer by name (Lulu, Mixam, Bookvault) or *the cheapest available* by a real quote; under it a live quote from every printer that could make it, at the draft's page count, with what the format would then sell for; then a card per printer in play with its own options (Lulu's case style; Mixam's lamination and jacket; Bookvault's paper, cloth, foil colour and positions, ribbon, bands, endpapers, sprayed edges), every change re-quoted. A printer with no keys says so and quotes as the mock.

**Jacket.** The **blurb** (two short paragraphs written for the back, under the companion's insight as a pull quote — never the site's copy reused) and the **flap** (what the book and its author are). Every book carries its jacket copy whether or not it is on sale.

**Note.** *A Note on This Edition*, the publisher's page — see below.

Beside the panels, the book itself: the interior as a book to turn, page by page; a select for the contents and for the cover when there is more than one; the EPUB to download; the cover flat.

## Save & render, then Set the editions

**Save & render** writes the block and re-renders every edition on the spot — a second or two each — so the preview is the file as it is. Nothing is sent anywhere.

**Set the editions** does the real thing: the files go to the private print bucket, the printers quote and check them, a printer that keeps a title (Bookvault) is asked for one (the confirmation names it — a title costs a fee once), the store's index is updated, and the book is on sale. An edition is identified by a hash of the text, the templates, the trim, the colours and the cover picture, so an edition already set is never set twice, and a changed word is a new one. The deploy sets any book flagged since the last deploy, too.

On a site with **no build box** — a cloud-only deployment, where nothing rebuilds — the pictures a
listing shows are drawn by *your own browser*, straight after the set, from the files that were just
made: the cover the shop draws the book from, and three pages of the interior. It says how many it
drew beside what it set. They are not a condition of the sale: the book is priced and orderable
first, and where a browser cannot draw them the listing simply shows the book alone. Keep the page
open while it works — if you press Save & render in the middle, the pictures are of text the edition
no longer has and are thrown away rather than kept.

## What the build does with a book

For every contents on offer it typesets the book and its companion — a blank first leaf, the title page, the colophon, the contents, the publisher's note (two-part editions only), the introduction, each chapter opening on a page of its own with its companion after it on a tinted ground, every highlight gathered at the back with its page — draws the cover to the printer's dimensions (a paperback's front is the book's own cover picture; a hardcover's is set in type on the cloth with the title in the foil's colour; the spine says Title · Edition), makes the EPUB, and for the store draws the printed book as an object and three pages of the print file as pictures (the fullest chapter opening, the same chapter in the other text, the page with the most highlights). Which pages are shown is decided from the file, never picked by hand.

A change to how books are typeset is checked by looking at every page of a rendered book, not by a page count.

## A Note on This Edition

Every two-part edition opens, after the contents, with the publisher's page — the page a publisher puts before a classic it has revised. It is written whole for that book, never assembled from a template, in three paragraphs of about two hundred words:

1. **What the book is and why it needs this.** Where and when it appeared, what has kept it read, and specifically what in its prose stands between a reader now and the teaching (the abstractions, the assumed scripture, the Victorian English, the period anecdotes) — diagnose the actual text.
2. **What the edition does.** Nearly the same paragraph for every book: it prints the book twice; Part One restates it in contemporary English, the same chapters in the same order, nothing added and nothing taken; each chapter closes with the principles it rests on; Part Two prints the original unaltered; in both parts the essential passages are highlighted and gathered at the back. Say exactly what was done and no more.
3. **Where to begin.** Readers new to the tradition begin with Part One; those who know the book find it unchanged in Part Two.

The voice is the house's: third person, matter-of-fact, a little dry. No second person, no selling, no instruction. Book titles in italics.

## Proofs

A **proof** is a record beside the sale, never a gate: a book set and quoted is on sale whether or not a printed copy has been read. **Order a proof** on the Proofs panel sends one copy to the administrator's own address through the print-order function (a print order flagged as a proof, never a purchase); **Mark proofed** records which edition was read. The grid shows proofed, changed since its proof (a changed word is a new edition), or never.

## Orders

Sales → **Print Orders** lists every order live: who, what edition, the printer, the printer's status (submitted → in production → shipped, with tracking), the cost. Two actions: send an order again (a new or failed one), and check its job now. Orders reach the printer by themselves the moment a sale is paid; the buyer is emailed when the parcel ships. See [The store](/content/docs/running-a-site/selling/store) for the sale itself.
