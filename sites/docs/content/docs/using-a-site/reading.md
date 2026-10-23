---
title: Reading on the site
description: The library, the reader, summaries, highlights, the quiz, the spoken book, and reading on a phone.
order: 30
sources:
  [
    packages/kit/src/lib/gated.js,
    packages/kit/theme/src/components/content,
    packages/kit/src/lib/tts,
    packages/kit/src/lib/interests.js,
    packages/kit/src/lib/rank.js,
    packages/kit/src/lib/records.js,
    packages/kit/theme/src/pages/DiagnosticsPage.vue,
  ]
reviewed: 2026-10-22
---

For anyone helping a reader, or writing the words a reader sees — this is what the reading side of a site does.

## The library

`/content` is the hub: books on a shelf, articles, the wiki and the docs, and a search (⌘K or the search button) across all of them — and, where the site has its social network, across the people with a page you may see, listed under People. The shelf can be filtered by theme (the site's _concepts_), and it has two views: **Everything**, the same shelf for everybody, and **Recommended For You**, arranged around what you have been reading and what you have bought. It is offered once there is something to go on; a site with a diagnostic or a survey of its own offers it sooner, with the invitation to take one. The site works out the tags you keep coming back to from the pieces themselves as they are tagged **now**, so a piece re-tagged after you read it changes what you are shown, and nothing you have read to the end is offered back to you — a piece you only skimmed still is, since that is the one you probably meant to come back to, and a book you have started and not finished stays on the shelf until you do.

## A book

A book opens on its cover page — the title, the author, the description, the companion's insight, the reader's progress and trophies, and _Your files_ for a buyer. The first page is the **introduction**, then the chapters, each on a page of its own with a chapter bar fixed at the foot. A link can open a book at one chapter by adding `?chapter=3` to its address, counted from the first chapter; that is how a course's lesson points at one.

- **Two modes**: the full text, or the **summary** (each chapter as its companion's summary and key ideas). The switch is in the chapter bar.
- **Highlights**: the editors' marks are coloured wavy underlines; a reader's own highlights are background washes, made by selecting text, kept on the account.
- **Test yourself**: the chapter's five-question quiz. Passing is four of five; a bronze trophy for the first chapter, silver for half the book, gold for all.
- **Listen**: where a recording exists, a player above the chapter bar — waveform, play, time, speed. On a desktop browser a chapter without one can be **generated** on the reader's own machine (the first time downloads the voice, about 400 MB, once); a signed-in reader's generation is shared for everyone after.
- **Free chapters**: a guest reads the first few chapters, a signed-in reader a few more, a member the whole book — as the book's settings say. The paywall page offers the ways up. A chapter a reader may read but a visitor may not takes a moment to open the first time.

## An article, a wiki page, a doc

An article is a dated piece with a cover; at its foot, the site's close. A wiki page and a doc have a tree of pages down the side and an on-this-page rail. A page above the reader's access level shows its head and a gate.

## A diagnostic

Some sites offer a guided diagnostic or questionnaire alongside the library. The site chooses its questions and interpretation; the shared screen hosts the site's own instrument. A signed-in reader's answers and readings can be kept with their account, and the site may use them to shape its results or recommendations. Starting over clears diagnostic answers and readings, not books, personal highlights, or accomplishments. A site that has no diagnostic simply has no such section.

## On a phone

Everything works at phone width: the reader's chapter bar, the player, the highlights, the quiz, the store, the chat. The in-browser voice is never offered on a phone or tablet (it needs a desktop's memory); recordings play everywhere. Push notifications on an iPhone need the site added to the Home Screen.

## Saying something

Where a piece takes comments you will find them at the foot of it — under an article, on a product. In a **book** they are per chapter: a Comments button in the reader's bar opens a drawer beside the page with that chapter's conversation and no other, so you can look, say something and carry on from the same line. Some of them are also a conversation in the community: the page says so and links to it, and anything you write in one place is in the other. What you may say is the site's choice, and the box is only drawn where you may.

**Replies keep their shape.** You can answer any comment, however deep in a conversation it sits. What is bounded is the drawing: replies indent a few levels and then continue in one run, and a reply drawn flat says whose comment it is answering, so a long exchange stays followable. A run of many replies folds behind a control saying how many are hidden.

**Some sites read comments before they appear.** Where a site does, yours waits and says so — and only you can see it until somebody has looked. It is never silently dropped, and you are never told why it is waiting: that is between the site and its moderators.

Where a site turns them on you can also leave a **reaction** (an emoji, as many as you like) or a **vote** (up or down, one each). Votes are off unless a site asks for them. Where they are on you can choose how the conversation is ordered — oldest, newest, top, best, or most argued over — and that choice is yours alone: it changes nothing for anybody else.
