---
title: Votes and reactions
description: Two ways of answering something without writing a reply — an emoji and a judgement — for a comment and for a message in a room, from one pair of tables and one rule.
order: 56.6
sources: [packages/kit/supabase/schemas/99-reactions.sql, packages/kit/src/lib/comments/model.js, packages/kit/build/reactions.test.mjs]
reviewed: 2026-09-26
---

A **reaction** is expressive: an emoji, several per person, saying how something landed. A **vote**
is a judgement: up or down, one per person, saying whether it was worth reading. They are not the
same act and they do not have the same arithmetic, so they are two tables and not one with a
nullable column pretending otherwise.

They ask the same two questions of a **comment** and of a **message in a room**, so each is one
table keyed by `(surface, target, person)` rather than a pair per surface — and the rule for who
may cast one is a single function taking the surface and the id, so the sentence "who may vote"
exists once. Where the two surfaces must differ they differ in what is passed to the rule.

```
reactions (surface, target_id, user_id, emoji)      surface: comment | message
votes     (surface, target_id, user_id, vote)       vote: +1 | -1
```

`reactions` is `space_reactions` grown a surface: every emoji anybody has left in a room is still
there, under `surface: message`.

## Two defaults, both deliberate

**Reactions on, votes off.** A score changes what people write as well as what they read, so a site
opts into that rather than finding it already running.

**A comment subject and a channel are set apart**, and neither inherits from the other: a site may
want voting on its forum and not under its books, or the reverse. A channel carries `reactions` and
`votes` of its own (its space sets the default its rooms inherit, and the projection resolves it, so
the database holds the answer rather than the question); a comment subject carries the same two,
from the site's comment policy.

`signal_takes(surface, target, what)` is that question, and `signal_may(surface, target, what)` is
whether this person may — which is the same standing as saying something there. Somebody who may not
comment may not vote; somebody who cannot read a channel cannot react in it; nobody with no account
can do either, because a vote from nobody is not a signal.

## Changing your mind is the same row

Casting the opposite **replaces** a vote; casting the same again **withdraws** it. One row per
person, never two, and never a count that drifts. `voteAfter(had, pressed)` is that rule, and
`voteTally(comment, next)` is what the page should show the instant somebody presses, before the
write comes back.

## The person chooses the order; the surface decides whether there is one

**Oldest first stays the default**, so turning voting on changes nothing about how a page reads
until somebody asks it to. Where a surface takes votes, somebody may choose:

| order | what it does |
| --- | --- |
| **oldest** | as written — a conversation read in the order it happened |
| **newest** | most recent first |
| **top** | the highest score: ups less downs |
| **best** | the most confidently liked |
| **controversial** | the most argued over: many votes, close to even |

Where a surface takes no votes only *oldest* and *newest* are offered: an order nothing can compute
is not a choice. The person's own order is theirs, is remembered, and never changes what anybody
else sees.

### best is not top

`best` is a confidence bound — Wilson's lower bound on the proportion of ups — and not ups less
downs. A comment **9 up and 1 down** beats one **40 up and 30 down**, because the second is disputed
and the first is not, while `top` puts them the other way round. A raw score rewards whatever was
seen most, and the difference between the two orders is the whole reason both exist: a system with
only one of them is a system where the loudest thread wins, which is the thing sorting was supposed
to fix. `build/reactions.test.mjs` pins it on exactly those numbers.

`controversial` needs both halves: two people disagreeing is not a controversy, and forty people
agreeing is not one either.

## A vote is a signal, and nothing is decided by arithmetic

A tally is recorded and readable, and **nothing is ordered by it unless the surface says so**. What
a community rewards is a decision about that community, and a platform that sorts by score
everywhere has made it for them.

**A downvote hides nothing.** A comment below any number is still there and still readable; removing
something is an act of moderation with a person's name on it.

## The tallies come back with the lines

`comments_on` returns, with each comment, how many of each reaction, which of them are this
reader's, the two vote tallies and this person's own vote — **aggregated**, two grouped scans over
the ids in hand, not a query per line. A thread of two hundred comments asking two hundred times is
the thing that makes a comment system feel slow, and it is invisible until it is.

The arithmetic over what comes back is pure (`src/lib/comments/model.js`): `reactionsOf` turns the
tally into rows most-first saying whether this person is among them, and `sortComments` applies the
order the person chose — over the roots alone, because a reply belongs to what it answers and
sorting the whole flat list would scatter every conversation.
