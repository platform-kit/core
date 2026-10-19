---
title: Books and companions
description: A book's file, its chapters, the editorial highlights, the introduction, the companion with its summaries and quizzes, the free chapters, and the spoken version.
order: 15
sources:
  [
    packages/kit/src/lib/gated.js,
    packages/movable-types/src/components/content/BookReader.vue,
    packages/movable-types/src/components/admin/ChapterEditor.vue,
    packages/movable-types/src/components/admin/CompanionEditor.vue,
    packages/kit/build/companion-io.mjs,
    packages/kit/src/lib/mastery.js,
    packages/kit/build/enrich.mjs,
    packages/kit/build/cover.mjs,
    packages/kit/src/lib/book-art.js,
    packages/kit/supabase/functions/_shared/enrich,
    packages/kit/build/enrich-cache.mjs,
    packages/kit/build/llm.mjs,
    packages/kit/src/lib/companion-body.js,
    packages/kit/src/lib/companions.js,
    packages/kit/src/lib/finding.js,
    packages/kit/src/lib/finding-rows.js,
    packages/kit/src/lib/finding-score.js,
    packages/movable-types/src/pages/AdminPage.vue,
  ]
reviewed: 2026-10-18
---

## A book is one file, edited by chapter

Content → Books lists every book in a grid; one opens as a form above its **chapters**. The book is split at its top-level headings (`# Chapter title`), one chapter open at a time in the editor, and every other chapter kept exactly as it was until you open it. The file is put back together on save.

The form holds: title, author, the **cover** (a picture — uploaded, or chosen from the [library](/content/docs/running-a-site/content/media); the field holds its address, `/uploads/books/<name>`), an optional share image, the description, the **introduction** (see below), a date, the reader level (beginner / intermediate / advanced), tags, the **topics** and **concepts** it files under (concepts are what the library's dropdown filters by; topics are the slots a site with recommendations uses), the **free chapters** per class of reader, and Published.

## The introduction

The thesis of the whole book, as its own page before chapter one, the same in either reading mode. It lives in the book's own file as the _introduction_ field and is edited as a text field on the drawer. It is not a chapter: it does not count toward the guest allowance, and its spoken recording is kept under its own key so the label can change freely.

## Free chapters

Four fields say how many chapters a guest, a signed-in reader, a paying customer and a member may read before the paywall. A blank field means the whole book for that class. The allowance starts counting after the introduction. Whatever is set, the store's _unlock_ for a book opens it whole.

Locked chapters are not published. A visitor's copy of the book holds each locked chapter's title and its first lines, which the paywall shows, and a locked chapter's summary, key points and quiz are left out too. A reader allowed further is sent the rest when they open the book; until it arrives the chapter says "Opening this chapter…", and if it can't be fetched it says so with a retry rather than showing the paywall.

## Highlights — the editorial marks

A book may carry marks baked into its text: a passage the editors think a reader should notice, drawn as a coloured wavy underline (a reader's own highlights are background washes, deliberately different). In the text a mark is `==the passage==`, optionally with a colour: `==the passage=={ocean}`.

The five colours are a code:

| Colour              | Speaks to                                                  |
| ------------------- | ---------------------------------------------------------- |
| `ember`             | spirit — the ineffable, the source, the mystical           |
| `sky`               | mind — knowing, clarity, self-knowledge, perception        |
| `leaf`              | earth — the body, nature, conduct, moderation, practice    |
| `ocean`             | emotions — desire, fear, contentment, humility, compassion |
| `sun` (the default) | a truth above those four, true at every level              |

Marking a book means going through it one chapter at a time and marking the one to three most important ideas the reader should take from that chapter — only the best lines, never lesser ones to fill a chapter. Every mark must **stand on its own** as a complete thought read out of context: extend a clause to its full sentence or couplet rather than mark a bare "It produces them…". A mark may span line breaks, so a whole stanza can be one mark.

In print every mark is one pale yellow highlight whatever its colour, and all of them are gathered at the back of the book with their page numbers, like a novel's epigraphs.

## The companion

Every book may have a **companion** — a second file, shown in the admin as the second tab of Books. It holds:

- the **insight** — one or two lines shown wherever the book is recommended and on its cover;
- for every chapter, matched to the book **by title**: a **Summary** (prose that loses no important point), the **Essence** (a list of the key ideas), and a **Quiz** (questions with four options and one right answer, optionally with a line saying why).

The companion editor shows the book's chapters down the side — a chapter's title is never typed, it is the book's, and a chapter the book no longer has is shown apart and can only be removed — and for the open chapter three tabs: the summary in the prose editor, the essence as a list of sentences, the quiz as questions with exactly four options and one right one. The server checks the companion against the book's chapters on save.

What the companion does on the site: **summary mode** in the reader (each chapter as its summary); the insight on the cover and in recommendations; **Test yourself** — the quiz — with mastery kept per reader (pass is four of five; bronze for the first chapter, silver for half, gold for all; shown on the cover, the shelf and the reader's accomplishments); and, on a site with the library's _Find your book_, the teaching the book is matched by.

**Find your book** is a separate discovery flow, not a reading test: a reader describes what they are working through and what kind of help they want, then sees a short list of books whose teaching and chapters fit those answers. They can refine the search; its suggestions do not replace the site's diagnostic results.

## Enrichment: writing the companion and the introduction by machine

The Books grid offers **Enrich** (the introduction and the whole companion) and **Introduction only**. Each runs the enrichment pipeline — a paid call to a language model in several narrow stages, each checked before the next — and writes the result into the files. A review page beside the run says what it found.

Two rules, because every run costs money:

1. When a prompt or a setting has changed, run **one sample** first — one chapter, or one short book — read it, and only then the rest. Never a parallel run or a whole-library pass on an unproven change.
2. Hand edits in a companion survive reruns: the pipeline redoes only the stages whose inputs changed. So fix a sentence in the editor rather than rerunning a book to change wording.

A library's companions may all be hand-written; the pipeline is for a new book, never a way to regenerate what exists.

## The spoken book

A site with the `tts` module speaks every chapter and every summary with a local text-to-speech model (no service, no cost), keeps the recordings by a name made from the exact words — so an edited chapter is respoken and an unchanged one never is — and serves them from a public bucket. The reader shows a player above the chapter bar where a recording exists and, on a desktop browser, offers to generate one on the reader's own machine where none does; a signed-in reader's generation is shared to the bucket for everyone after. No recording, no player: a book never needs audio to work. Making the recordings is a developer's command (`platformkit tts`); see [Spoken books](/content/docs/building-a-site/spoken-books).

## Putting a book in print

A book is sold in print through its **print block** — the formats, prices, printers and jacket copy — on **Store → Print editions**. The Books drawer links to that page. Where generated print-cover art is absent, book displays fall back to the ordinary cover from the book's markdown. See [Print editions](/content/docs/running-a-site/selling/print-editions).

## Comments

A book takes them with `comments:` in its own file, and naming a space and a channel puts the conversation on the community's board as well as on the cover page — one thread, two ways in. See [Comments](/content/docs/building-a-site/comments).
