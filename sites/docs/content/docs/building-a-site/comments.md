---
title: Comments
description: One conversation system for anything — an article, a wiki page, a book, a product, an event — on the page, in the community as a forum thread, or embedded on somebody else's site at Disqus's own address.
order: 56.5
sources:
  [
    packages/kit/supabase/schemas/97-comments.sql,
    packages/kit/supabase/schemas/99-reactions.sql,
    packages/kit/src/lib/desk/comments.js,
    packages/movable-types/src/components/CommentsAdmin.vue,
    packages/kit/build/models/core/comments.mjs,
    packages/kit/src/lib/comments.js,
    packages/kit/src/lib/comments/model.js,
    packages/kit/build/comments-push.mjs,
    packages/kit/build/comments-sdk.mjs,
    packages/kit/build/steps/comments.mjs,
    packages/kit/build/steps/comments-sdk.mjs,
    packages/movable-types/src/components/content/CommentThread.vue,
    packages/movable-types/src/comments-embed.js,
    packages/movable-types/src/pages/CommentsEmbedPage.vue,
  ]
reviewed: 2026-10-19
---

People want to say something under an article, a wiki page, a book, a product and an event. That is
**one** question, so there is one answer: a comment names a **subject** — a kind and an id — and
nothing in the system knows what those kinds are. Five tables would be five sets of policies to get
subtly different.

## A thing takes comments by saying so

Off unless the file says otherwise, because a site that has not thought about moderation should not
wake up to a comment section.

```yaml
comments: members # off · everyone · members · hosts
comments: { allow: members, space: the-practice, channel: the-books }
```

**In the admin it is three controls**, on every kind that can be commented on: _Who may comment_
(off · anybody signed in · members · hosts) and, once somebody may, a _Space_ and a _Room_ — the
site's own spaces, and its **forum** rooms only, because a stream is not a thread and cannot hold
one. Leave both blank and the conversation stays on the page. Nobody types the block.

Off is the default everywhere, and off written inside the block means off: `{ allow: off }` reads as
"takes none", the same as the bare word. It used to fall through to the default and come back as
`members`, so turning comments off in a block turned them on.

`build/comments-push.mjs` projects one row of `comment_subjects` per thing whose file says it takes
them — beside the events' own, which `events-push` writes. It is a projection and the files own it:
a subject no file declares any more is removed. Two things it never touches: the comments, and
`post_id`, which is the thread's identity. In local development, changing a Markdown declaration reruns the matching compile and local projection; a failed read or write stops that refresh before cleanup can remove rows.

### A book is commented on a chapter at a time

"What did you think of The Kybalion" is not a conversation anybody has; "chapter four lost me" is.
So a book that takes comments gets one subject **per chapter** — `the-kybalion/chapters/4` — and no
book-level thread at all. In the person a **Comments** button opens a drawer beside the page showing
that chapter's thread and no other, so somebody in the middle of reading can look, say something and
carry on from the same line. On the community's board they read as _The Kybalion — 4. The Principle
of Polarity_, which is a list of things people are actually talking about rather than a row of book
titles.

## A reply may answer a reply; the indent is what is capped

`parent_id` was capped at one level, with a reason beside it: _a thread that nests forever is a
thread nobody reads to the end of_. That reason is about **reading**, and it was answered by
forbidding the **reply** — which is not the same thing. Somebody answering the third comment in a
run is answering _that_ comment, and flattening it to the top loses who they were talking to.

So a comment may reply to any comment, to any depth, and the depth is kept. What is bounded is the
**drawing**, by two numbers on the subject:

|            |                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| `depth`    | how far replies indent before the rest continue in one flat run (3 by default; **1 for the embed**)    |
| `collapse` | how many replies under one comment are shown before the rest fold behind a control saying how many (5) |

`src/lib/comments/model.js` works it out — pure, so the page and `build/comments.test.mjs` read the
same arithmetic. `shape(rows, { depth, collapse, open })` returns the lines in order, each with the
indent to draw it at and, where it is drawn shallower than it really is, **who it answers**: once
the indent stops, the shape no longer carries that, and a flat run answering four different people
is a conversation nobody can follow.

An embed is a narrow column on somebody else's page, which is why its depth is 1: a comment, and
every reply to it or to any of its replies in one run beneath, each naming the person it answers.

## Where a thread sits on the page

A conversation is prose, so it takes the **reading measure** — `--readw`, the same column the
article's own text is set on, named once in `atlas.css` and read by both. A thread at the page's
full width does not read as the end of the piece; it reads as a band across the site that happens
to be below it. The measure is the thread's own answer and is the same on every page, which is why
it is in the component and not in each host.

How a thread is **separated** from whatever came before is the page's answer, not the thread's, and
is asked for with `rule`. The article passes it, because there the thread continues a column of
prose and the person should see it continue. A page of sections does not: the store already
separates its own, and a second hairline a few pixels under the first at a different width reads as
a mistake rather than as a division.

The **gutter** belongs to whichever host puts the thread at the page's own root — only the article
does — since a host that already has one would double it and leave the thread indented from the
column it is meant to continue. That is what happened on the event page the first time.

`bare` is the person's panel and the iframe embed. Each is already a column, so it takes neither
measure nor rule: a column inside a column is an indent nobody asked for.

## Whether what is said appears at once

A subject carries an **approval** setting:

|           |                                                               |
| --------- | ------------------------------------------------------------- |
| `none`    | everything appears at once — the default                      |
| `all`     | everything waits for a person                                 |
| `trusted` | everything waits except from somebody the site already trusts |

**Trusted** is a standing the site can already answer, true before anybody typed anything: staff, a
live membership, a paid purchase, or an author a moderator has released before. That last one is
the approval stamp on the comment that was released (`comments.approved_at`) and not a flag on the
profile — one fact, one place, nothing to fall out of step.

A held comment is **visible to its author**, marked as waiting, and to nobody else but whoever may
moderate it. A comment that vanishes on posting is how somebody decides the site is broken and says
the same thing twice.

The practical difference from a spam filter: a filter decides a comment is bad and is sometimes
wrong about a real person, invisibly. This decides a **person** is not yet known and shows their
comment to a moderator, who decides.

### Flagged words: a machine may flag, only a person decides

The site may declare words that hold a comment for review — profanity, slurs, a competitor's spam,
whatever that community has decided it does not want appearing unread. A match **holds** the
comment and names the word to the moderator, who can disagree with the list. It never removes,
refuses, edits or scores anything: the line is between queueing work for a person and being the
person.

Three details decide whether the filter is useful or a nuisance:

- **Whole words, case-insensitively, never substrings.** Substring matching is how "Scunthorpe" and
  "assassin" get held, and a filter that cries wolf is one a moderator stops reading.
- **The list is the site's own**, not one the platform ships. What a community will not have said is
  that community's business.
- **A flag beats trust**, because the list exists for when trust is misplaced — and the author is
  never told which word caught them: a list you can probe is a list you can walk around. The list
  lives in `app_settings`, which no browser can read, and `comment_flagged_word` is granted to the
  service role alone.

`comment_approve` and `comment_refuse` are the moderator's two acts, and each writes a row of
`space_moderation` like any other removal — a person's name, a moment, a reason where one is given,
and a record nobody can edit. It is the only act that happens _before_ anybody else reads the
words, which is exactly why it is written down.

## Votes and reactions

A **reaction** is expressive — an emoji, several per person. A **vote** is a judgement — up or down,
one per person. Both are answered for a comment and for a message in a room by one pair of tables
(`reactions`, `votes`, keyed by surface, target and person) and one rule for who may cast one, so
"who may vote" is written once. See [Votes and reactions](/docs/building-a-site/reactions).

Every surface says for itself which of them it takes. **Reactions on, votes off** is the default
everywhere, and a comment subject and a channel are set apart — wanting a scored forum says nothing
about wanting scored book chapters.

## Who may read, and who may say — two questions

A members-only article may take comments from members; a public one from anybody signed in; a book
may show them and take none. Both live on the projected row (`access` and `allow`), so one policy
answers for every kind:

- **read** — `comment_may_read`: the subject's `access`, on the same ladder the rest of the library
  is gated by.
- **write** — `comment_may_write`: `off` · `hosts` (staff) · `everyone` (anybody signed in) ·
  `members` (whoever may see it).

## One conversation, two doors

Where a subject names a forum **channel**, its comments _are_ a post in that channel. The first
comment opens the post — so the board is not full of empty posts for every book in the library —
and after that the page and the board are two views of one thread. Say something on the book's page
and it is in `#the-books`; say it in `#the-books` and it is on the book's page.

The moderation comes free with it. A comment is a space message, so reports, removals and the
moderation queue already cover it, and the desk needs no second set of tools for a second kind of
talk.

A subject with **no** channel keeps its comments in `public.comments`. That is what a site with no
community wants, and what an embed on somebody else's domain gets.

## On the page

`CommentThread.vue` takes a kind and a subject and nothing else — which of the two places the thread
lives in is the database's business, and a component that had to know could get it wrong. It asks
`comment_subject` once for what the conversation is (does it exist, may I join it, where else can it
be read) and draws **nothing at all** where the thing takes no comments: an empty "Comments" heading
under every article on a site that never wanted them is worse than none.

## Where a comment is answered for

A comment whose subject names a forum room **is** a post in that room: it is moderated there, by
whoever moderates it, with the reports and removals the community already has. One attached to no
room — a site with no community, an embed on somebody else's domain — has no room's moderators, and
without somewhere to answer for it, it would be a conversation nobody is responsible for.

So there are two surfaces, and they are not the same list:

- **The desk's Comments queue** (`src/lib/desk/comments.js`) — the unattached ones that are waiting
  to be decided, in the staff's one list beside the support desk and the clients' threads. The
  source is a file and a line, so it needed no change to the desk itself.
- **The admin's Comments section** (`/admin/comments`) — _every_ comment on the site, narrowed by
  state (waiting · live · removed), by where it is, and by kind.

Both offer **Publish it** and **Refuse it** by name. Neither uses the desk's tick for it, and neither
has a control that edits somebody else's words: a moderator publishing something happens before
anybody else has read it, and rewriting what a person said is the one act this system does not have.

## Votes and reactions in a room

A channel carries `reactions` and `votes` of its own; a space sets the default its rooms inherit,
and the projection resolves the ladder so the row holds the answer rather than the question. A room
that says nothing takes reactions and not votes, like everything else.

```yaml
# content/spaces/the-practice/the-books.md
name: The books
votes: true # this room scores its posts; the others do not
```

A comment subject is set apart from this and inherits nothing from it, because wanting a scored
forum says nothing about wanting scored book chapters.

## A kind may be open-ended

Everything of the site's own is projected, because the site knows what it has. A page on **somebody
else's** site is not: an embed on a blog with two hundred posts cannot have two hundred rows
projected for it, and Disqus makes a thread the first time anybody comments.

So `content/comments.md` declares which kinds are open:

```yaml
kinds:
  - kind: page
    allow: members
    space: the-practice
    channel: the-books
```

That writes one wildcard row per kind (`subject: '*'`) carrying the access, the allow and the
channel. A concrete subject is made the first time somebody comments, from that row, **named by the
title the embed passed** — `this.page.title`, or the document's. It is still a declaration: the site
says the kind is open, and nobody can invent a kind. A site that declares none can be embedded
nowhere, which is the right default.

A caller decides three things and nothing else — and it may NAME a thread, never rename one:

|           |                                                    |                                           |
| --------- | -------------------------------------------------- | ----------------------------------------- |
| **slug**  | its identity, and so the subject                   | `/content/articles/listening-back`        |
| **title** | what a person reads, in the board and in the queue | `Listening Back`                          |
| **url**   | where the page actually is, shown as the way back  | `https://example.com/blog/listening-back` |

Two pages with the same slug are one conversation, and a page that changes its address keeps its
comments. Declare none and the slug is the page's path and the title its document title, so a
snippet pasted with no configuration still works.

## Embedded on somebody else's site

At **Disqus's own address and in Disqus's own shape**, because answering a snippet people already
have in their pages means nobody has to learn anything to try it. Change one line — the `src` — and
the conversation moves here:

```html
<div id="disqus_thread"></div>
<script>
  var disqus_config = function () {
    this.page.identifier = '/content/articles/listening-back' // the slug, and so the thread
    this.page.title = 'Listening Back' // what a person reads
    this.page.url = 'https://their-site/blog/listening-back' // the way back
  }
  var disqus_kind = 'page' // ours: which kind of thing this is
  ;(function () {
    var d = document,
      s = d.createElement('script')
    s.src = 'https://<this-site>/packs/js/comments.js'
    ;(d.head || d.body).appendChild(s)
  })()
</script>
```

### It is a frame, and that is the whole design

The script draws an **iframe of a page of ours** (`/embed/comments`) and sizes it from what that
page reports. It used to mount the thread into the host page, and that could only ever be **read**:
a script in somebody else's page runs on _their_ origin, and the person's session lives on _ours_ —
so everybody in it was a guest, and a guest may not comment. A thread nobody can join is half a
comment system.

Inside a frame of ours the session is ours to read, the sign-in is ours to offer, and every policy
behaves exactly as it does on the site. Two things follow that are worth having for their own sake:
**nothing of ours runs in the host page** — no Vue, no stylesheet, no client library, just a few
hundred bytes and an iframe — and the frame carries no background of its own, so it sits in their
page rather than painting over it.

A browser partitions storage by the top-level site, so **signing in inside the frame signs somebody
in for that site and no other**. That is right rather than a shortcoming: somebody who signed in
under one publisher's article has not signed in everywhere the embed appears.

### Or write the frame yourself

It is a URL, so nobody has to run a script at all:

```html
<iframe
  src="https://<this-site>/embed/comments?kind=page&subject=/a-post&title=A%20post"
  style="width:100%;border:0"
  height="600"
  loading="lazy"
></iframe>
```

|           |                                                                  |
| --------- | ---------------------------------------------------------------- |
| `kind`    | which kind of thing this is; the site must have declared it open |
| `subject` | the slug, and so the thread's identity                           |
| `title`   | what a person reads, in the board and in the desk's queue        |
| `url`     | where the page actually is, kept as the way back                 |

The frame says how tall it has become on every change (`postMessage`, `{ platformkitComments: true,
height }`), and grows while the sign-in is open — a modal mostly below the fold of a 200-pixel frame
is a sign-in nobody can reach, which is the one thing the frame exists to offer. Size it from that
message, or give it a fixed height and let it scroll.

### Where it may appear

`content/comments.md` may name the domains the embed belongs under (Community → Comments → Policy):

```yaml
domains: [example.com, thepartnersite.org]
```

A domain covers its subdomains, because somebody writing `example.com` is not thinking about `www`.
**Name none and the embed works anywhere**, since a site that has not decided has not decided
against.

Two things this is honest about. It is **not a secret**: a determined person can always comment by
visiting the site itself, and what a whitelist prevents is the site's comments appearing under pages
it did not agree to. And the in-page check gives a readable refusal rather than a blank one — the
real browser-level fence is a `frame-ancestors` header, which the host serves:

```
Content-Security-Policy: frame-ancestors 'self' https://example.com https://*.example.com
```

on `/embed/*`. Set both: the header stops the frame loading at all, the list in the policy can be
changed without a deploy and says why in words.

**Not** honoured, and it says so in the console rather than pretending: the Disqus shortname (this
site _is_ the forum, so there is nothing to name), SSO, and the moderation API.

The `.disqus-comment-count` spans still work and are not framed — a number inside somebody's
sentence cannot be. They are a plain read of a public count.
