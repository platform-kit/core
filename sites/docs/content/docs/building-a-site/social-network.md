---
title: The social network
description: A page per person, follows, a timeline and posts that each say who may read them — closed to the site's own people by default, and served to Bluesky's app and every atproto client over the same tables.
order: 56.995
sources:
  [
    packages/kit/build/network-media.test.mjs,
    packages/kit/supabase/schemas/98-community.sql,
    packages/kit/build/community-notes-db.test.mjs,
    packages/kit/build/network-access.mjs,
    packages/kit/supabase/schemas/93-network.sql,
    packages/kit/build/network-db.test.mjs,
    packages/kit/src/lib/network,
    packages/kit/build/network.test.mjs,
    packages/kit/theme/src/pages/FeedPage.vue,
    packages/kit/theme/src/components/network,
    packages/kit/theme/src/content/ui/network.md,
    packages/kit/theme/src/pages/PersonPage.vue,
    packages/kit/theme/src/components/NetworkAdmin.vue,
    packages/kit/src/lib/network/apps.js,
    packages/kit/supabase/functions/atproto,
    packages/kit/supabase/functions/_shared/atproto,
    packages/kit/build/atproto-interop.test.mjs,
    packages/kit/build/network-keys.mjs,
    packages/kit/theme/src/components/network/NetJoin.vue,
  ]
reviewed: 2026-10-22
---

The `network` module is the site's own social network: every member may have a page, follow other members, post, and read a timeline of the people they follow. It is what Bluesky and Mastodon do for strangers, and what Circle, Mighty Networks and Skool do for a paid community, kept on the site and under its own rules. Module: `network`, for the git and cloud shapes; a static site has nowhere to keep a post and is refused with it on. Like every module it is on unless the site's config says `network: false`.

## On the site

| address               | what it is                                                                                                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/feed`               | Home, in two tabs: **Following** — the composer, then the reader's own posts, the people they follow and what they reposted, and the feeds of every space they are in (only the ones they pinned where the site sets `community.pinning`) — and **Discover**, everything on the site the reader may read, newest first |
| `/feed/explore`       | people found by name (`network_find`), and Discover                                                                                                                                                                                                                                                                    |
| `/feed/notifications` | likes, reposts, follows, replies and quotes — with the spaces on, their mentions, thread replies and events coming up too — newest first, filtered by tab; opening it marks them seen                                                                                                                                  |
| `/feed/post/<id>`     | a thread: the post, the post it answers, and every answer the reader may read, each hanging from what it answers by a line                                                                                                                                                                                             |
| `/p/<username>`       | somebody's page, as before — with, when the network is on, how many follow them and whom they follow, Follow, a menu to mute, block or report them, and what they posted that the reader may read                                                                                                                      |

**The layout is a social app's**: the network's own navigation down the left (`NetRail.vue`: Home, Explore, Notifications with its count, Spaces where the site has them, the reader's Profile, and the Post button, which opens the composer in a window over the page), the column in the middle under a sticky header with its tabs, and on the right search, **Who to follow** (`network_suggestions`: people with an open page the reader can see and does not follow, most followed first) and the reader's spaces, each pinned or not with one press (`NetAside.vue`). A narrower desk keeps the icons alone and drops the right side; on a phone the places become a bar along the bottom and the Post button floats above it. A post is drawn by one card (`NetPost.vue`): name, handle and time on one line, the words, the pictures, and reply · repost · like · share (the post's address, copied) · more, each coloured as it is pressed. A space's post wears the same bar wherever it is read — on the timeline and in its own feed channel (`SpaceFeedActions.vue`) — its like a ❤️ reaction written as the spaces write any reaction, its repost place left empty since a space's post is not reposted, and its last place a way into the space; a post to Everyone carries no badge, a narrower one says who it is for. The header carries a Home button for a signed-in reader, with the count of what has happened to them since they last looked (`network_unread`). Every page under `/feed` is `noindex`: a timeline is a person's own.

**The composer** asks who can see the post before it is sent, as a chip under the words naming the audience ("Everyone ▾"), which opens a menu of the choices, each with its line saying what it means; a ring beside Post fills as the post nears its length. The choices are Everyone, People here, and each of the reader's spaces that has a feed channel (`network_spaces()`) as "{space} members". An answer is offered only what its parent allows, and says so. **A post carries pictures and videos** — up to ten, each a picture (JPEG, PNG, WebP or GIF, 10 MB) or a video (MP4, WebM or MOV, 100 MB, three minutes), each picture with a line describing it — refused by name before anything is sent (`_shared/atproto/media.js`, the one rule the browser and the functions read). They go to the private `network` bucket under the author's own id, a video with its first frame drawn in the browser and put beside it as a JPEG poster (`network/probe.js`), and are read by whoever may read a post that names them (`network_can_read_image`, the poster included); the post keeps them as `media`. One shows at its own shape, held between 4:5 and 1.91:1; two or more swipe as a carousel with arrows under a pointer, dots and a counter (`NetMedia.vue`); a video plays muted and looped while most of it is in view, never under reduced motion, and its button gives it sound. A post to a space carries them too, kept where the space keeps its files. On the wider network a post goes as up to four pictures or one video; a larger or mixed carousel goes as its first four pictures and a link to the whole post.

**A post's card** draws a network post and a space's message alike: the face, the name (linked to the page where it is open), the handle, who can see it, when, the words with links cut out of them (never markup — `segmentsOf`), the pictures, what it quotes, and Reply · Repost · Like · More in a row beneath. A like or repost moves the count at once and moves back if the database refuses it. More holds Delete on the reader's own post and Report on anybody else's; a report is a reason from a list and a line of the reader's own.

The client is `lib/network/`: `model.js` (pure, pinned by `build/network.test.mjs`: what an answer may be read by, joining pages, threads, links, time in the browser's own words), `api.js` (the store over the tables, as the reader) and `nav.js` (the header's count). Names and faces come from `network_people(ids)` — a name, a face and the page's address only where the page is open, never an email — and a person's counts and where the reader stands with them from `network_person(id)`. The words are the theme's `network` scope (`nav`, `shell`, `timeline`, `composer`, `audience`, `post`, `person`, `report`, `notes`, `thread`).

The site's config may say `network: { federate, apps, access, appview, relay }`; `federate`, `apps` and which grants exist reach the browser, so the composer can say what Everyone means and the pages know what is offered.

`community.access` gates Events, Messages and Notifications before their own rules run. A reader outside Messages cannot open even an existing direct-message thread; a member who is admitted but has declined direct messages blocks only new conversations, not one already open.

**For You** (`community: { forYou: true }`, off by default) makes Explore a grid of the photo and video posts the reader may read (`NetForYou.vue` over `network_for_you` in `98-community.sql`): the last thirty days ranked by (likes + 2·replies + 3·reposts + 1) over the hours since raised to 1.5, weighted 1.5 toward somebody the reader follows, 1.3 toward somebody they answered, 1.2 for a post in a space they are in, and arranged so no person has more than two tiles in any six (`spread`). Square tiles, a video two tall, a mark on a carousel and a video, likes and comments over a wash on hover; a tile opens the post — the media large beside the post and its way to the conversation, one above the other on a phone, arrows and the keys between tiles. People search stays at its top. With it off, Explore is not a place.

**The card and the composer.** Every post — the network's or a space's — shows Comment and Like with their counts; Repost (a network post only), Copy link, Report or Delete and, on a space's post, the way to it in its space are under "…". A post says who can see it only when that is narrower than where it is read: on a site that does not federate "People here" is the default and is not said; on one that does, Everyone is. The composer is one line — the reader's face and "Write something…" — until it is pressed, and folds back when it is left empty. **A site may hide following** with `community: { hide: ['following'] }`: Home is then one feed of everything the reader may read, with no Following and Discover tabs, no Who to follow and no follow buttons or counts on a person's page; follows already made are kept and show again when it leaves the list.

A space's post on the timeline names people the way its room does: the `<@id>` a mention is stored as is read as `@Name` in the accent (`mentionParts`, the spaces' own reading), and the names it needs are asked for with the post.

**The network may be sold.** `network.access` gives two grants, `read` and `write`, each written as a space's `fill` is — "members of the network tier", "whoever bought the network pass" — compiled by the same function (`build/network-access.mjs` over `buildFill`) so an unknown tier or offer refuses the assembly, and written into `app_settings` (`network_access`) by the data script on every migrate and deploy — ahead of the cron block, which `data.sql` always ends with. `network_admitted(user, grant)` reads it and the read rule (`network_can_read`), every write policy (posts, likes, reposts, follows, pins) and the notifications ask it; whoever may write may read, the staff (anybody holding a role) always take part, blocking and muting stay open to everyone. Outside `read`, the column shows the join card (`NetJoinCard.vue`, words `## access`) in place of everything — no tabs over it, no filters, and no Post button in the navigation, which asks the grants as it mounts — though with the spaces on the notifications still list the spaces' part; inside `read` but outside `write`, a compact card stands where the composer was and the posts carry no actions. The card's button buys `access.join` — subscribing to a membership, checking out anything else — and where the site names its plans page (`access.plans`, an address like `/pricing`) a quiet **View more plans** link sits under it (`plans` in `## access`). A line the site's words leave empty is not drawn, so a card may be a title, a price and a button; a round price reads round (`$100 a month`). Free to read and paid to post is `write` alone.

**Every other place of the community may be entered by a rule too** (openspec: community-access-by-entitlement). `community.access` gives one to **Events**, **Messages** and **Notifications** — the places that keep rows of their own — and a registered place carries its own `access`; each is written as a fill and compiled by the same function, into one row of `app_settings` (`community_access`). `community_admitted(place)` (defined beside `space_fill_matches` in `90-spaces.sql`) answers for the reader: no rule, open as before; the staff, always; anybody else when one of the place's rules holds. The database holds it where the rows are — `event_for_me` asks it before any event's own audience, `space_dm_open`, `space_dms` and the insert of a line into a direct message ask it for Messages, `network_notifications` for Notifications — and the browser asks it once per session for every gated place (`admission()` → `net.places`). A place the reader may not enter keeps its row in the menu with a small lock where a count would be (`locked` from `socialPlaces`, `lockedPlaces` in `places.js`) and opens on the same join card, placed exactly as Home places it; a guest is outside every gated place. Coaching takes no rule of its own: what can be booked is each type's `requires`, and the chat has its own (a member, or a paid session's week with its coach). A reader who is in no space and has none open to them is not shown the Spaces heading at all, rather than a Browse page saying there is nothing to join.

**Message from a person's page.** Where the spaces are on, a person's page offers **Message** beside Follow when the reader and they share a space with direct messages on and they have not declined them there (`space_dm_where` asks exactly the rules `space_dm_open` keeps — an existing conversation always reopens, staff may write to anyone); pressing it opens the conversation in that space. Otherwise the page says "{name} isn't taking messages here."

**Other apps are off unless the owner turns them on** (`network.apps`, default `false`). Off, nobody can sign in to the site from Bluesky's app or any other atproto client: the account page offers no app passwords, and the atproto surface refuses every sign-in and every read an app would make — a space's feed among them — answering only the site's own description and, where it federates, what relays need ([the reference](/content/docs/reference/atproto-api)). On, a member makes an app password on their account page and an app reads exactly what they may read on the website, under the same rules.

**Where the network is drawn is the layout's** (`community.layout`). In the `chat` layout — the default — with the spaces on, `/feed` opens inside the spaces area: the spaces column carries one **Home** entry for the network timeline and a separate **Notifications** entry (with the count of what is new), not a second Feed entry; the network's column (`NetColumn.vue`) fills the middle and, where there is room, search, Who to follow and — where the site sets `community.pinning` — the spaces a reader may pin stand beside it (`NetAside.vue`). A site with the network and no spaces keeps `/feed` as its own three-column page, its middle column about 680px wide. In the `social` layout the spaces page wears the social frame instead of its two columns (`SocialNav.vue`, `SocialAside.vue`): a navigation of two sections — Home (the feed), Explore where For You is on, Messages with the reader's coach pinned in it, Events, Notifications, then Saved, Drafts and a customer's tickets while they hold something, and for the staff Work, one row whose total shows while it is folded and which opens to a row per queue; then the spaces, each folded unless the reader is in it, its feed first among its rooms, and a space of one room opened by its own row — the open space's name and tabs (Feed · Chat · Events · People · About · Moderation for its keepers) above the column, the next events and nothing else on the right, and the staff's queues taking the column and the right together; on a phone a bottom bar. [Spaces](/content/docs/building-a-site/social-network) has the whole of it. The views and their rules are the chat layout's, untouched.

## Bluesky's app, and every other atproto client

The network is also served as an **atproto server**: the `atproto` function answers the protocol's own methods over the same tables, as the signed-in member, so Bluesky's app and any other atproto client signs in with the host swapped and reads and writes the network under exactly the guards the site's pages meet. The surface adds no rule of its own; a closed site refuses everything addressed to another server, saying the network is closed. The whole of it — the methods, the identities, the tokens, the refusals — is [The atproto API reference](/content/docs/reference/atproto-api).

A member signs in from their own account page's **Other apps** card (`NetApps.vue`): the server's address to give the app, the handle they are known by (their username under `NETWORK_HANDLE_DOMAIN`, or until they take one a name made from their id), and an **app password** made there, shown once, revoked there. They never give another app their own password. The host routes `/xrpc/*` and the two `/.well-known` identity paths to the function (`deploy/_redirects`, only while the module is on); the dev server proxies them.

A post written in another app goes to the widest audience its writer has — everyone for a member who has joined the wider network, the people here for everybody else — since a client cannot ask. Answering a space's post from another app is a reply in that room; liking one is the room's own ❤️. Each space with a feed channel appears in the app as a feed of its own: its posts to a member, nothing to anybody else.

## The wider network: the site's switch, then each member's

A site **federates** by saying so in its config — `network: { federate: true }`, with `appview` and `relay` naming the app view it reads the world from and the relay it asks to crawl it (Bluesky's, unless it says otherwise). Off, which is the default, the network is closed: the protocol answers only the site's own people and refuses everything addressed to another server.

On, a member may **join**, from the Join the wider network card on their account page (`NetJoin.vue`; a username first, since it becomes their handle). Joining is their own act and does four things: a portable `did:plc` identity is made for them at the PLC directory, its genesis operation naming their handle, this site as the server holding their posts and a signing key made for them and kept in Vault, all signed by the site's rotation key (`NETWORK_PLC_ROTATION_KEY` — `node ../../packages/kit/build/network-keys.mjs` prints one; never rotate it away); their page becomes public; their public records — their everyone posts, their likes and reposts of public posts, whom they follow, whom of the joined they block, their profile — become a signed repository; and the relay is asked to crawl the site. **Leaving** takes the repository down and tells the network the account is deactivated; the card says that copies other services already made may stay. Joining again is the same identity.

The repository is **derived**: whenever a joined member's public rows change, a trigger queues them (`network_dirty`) and asks the function over pg_net to make the repository agree — the difference committed and signed with Bluesky's own repository library — and the `network-project` job (every five minutes) catches anything the ask missed. A post to the people here is never in it: a signed repository is one tree that relays copy whole. Every commit, identity change and account change is numbered on `network_seq`, and the sync methods and the event stream (`com.atproto.sync.subscribeRepos`, a WebSocket) serve it, resuming from a relay's cursor; the `network-crawl` job asks the relay to crawl again once a day. A moderator's removal is a deletion on the stream, a suspension a takedown, its lift the account active again.

A joined member reads **the world outside** through the app view: a profile, a post or a thread of somebody elsewhere is asked of it as that member, with a service token signed by their own key, and the first page of their timeline and of their notifications merges Bluesky's with the site's own (a later page is the site's own). Nothing that comes back is stored. A member who has not joined asks nothing of anybody elsewhere, and is told why.

A host that serves a federating site must pass WebSocket upgrades on `/xrpc` (the generated nginx does) and answer every name under `NETWORK_HANDLE_DOMAIN` — a wildcard DNS record and certificate — with the same rewrites, since each member's handle is a host whose `/.well-known/atproto-did` the function answers.

`build/atproto-interop.test.mjs` checks it with the network's own tools, in `npm test`: a PLC directory of its own that accepts an identity only where Bluesky's PLC library says its genesis operation is valid; the repository verified against the key the DID document names, holding the everyone post and not the one for the people here; the event stream read by Bluesky's own firehose consumer — every commit's signature checked — dropped and resumed from its cursor, every event once; an app view of its own that answers only a service token Bluesky's server library verifies; a removal on the stream as a deletion; leaving as a deactivation. It needs the function served with `NETWORK_FEDERATE=1` (a local stack only — the deploy refuses it), `NETWORK_PLC_URL` and `NETWORK_APPVIEW_URL` pointing at its stand-ins, `NETWORK_RELAY_URL=none` and a rotation key, and skips itself, saying so, otherwise. The one thing it cannot prove is Bluesky's own relay crawling a public host — that is checked by hand.

## Every post says who may read it

A post has exactly one audience:

| audience              | who reads it                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| **everyone**          | any signed-in member; a guest only where the author's page is open, or the author has joined the wider network |
| **people here**       | any signed-in member of the site, and no guest                                                                 |
| **a space's members** | the members of that space, and nobody else                                                                     |

The third is not a row of the network at all. A post to a space is a message in that space's **feed** channel (a channel read as a feed, beside stream and forum — see [Spaces](/content/docs/building-a-site/social-network)), so the space's own guards, moderation and encryption apply to it unchanged, and the timeline merges it in. A space with more than one feed channel takes such posts in its first.

Who may read is decided by the database and nowhere else. One function, `network_can_read`, answers it, and every policy and every read asks it — the site's pages, the timeline, the notifications, and the atproto surface, which runs as the caller. It reads, in order:

- the author always reads their own post;
- nobody else reads a removed post, a suspended author's post, or across a block;
- **everyone** is read by any signed-in person, and by a guest where the page is open or the author has joined the wider network;
- **people here** is read by any signed-in person.

## The audience never widens down a thread

A reply or a quote may not be read by more people than the post it answers: a reply to a **people here** post cannot go to **everyone**. The post being answered must be one its author can read, and no block may stand between them. A reply's root is always the thread's first post, whatever a client sends — one rule for every door, held by a trigger. Answering a post elsewhere on the network (a `reply_parent_uri`) needs the author to have joined the wider network, since what they answer is public there.

A post is never edited, as on Bluesky: what somebody replied to is what was said. It may be deleted by its author.

## Follows, likes, reposts, blocks and mutes

Each is a record of the person who made it, with an atproto record key (a TID, made by `network_tid()` so a post from the site's own pages and one through the protocol are keyed the same way). Likes and reposts are once per person per post; a person cannot follow themselves.

A **block** is mutual: either side's block hides each from the other everywhere — posts, pages, replies — ends every follow between them at once, and stops either following, replying to, quoting or liking the other. Lifting it does not restore the follows; following again is each person's choice. A block is read by the blocker alone.

A **mute** is private: the muted person is gone from the muter's timeline and notifications, still readable where the muter goes to look, and never told.

## The timeline and the notifications

`network_timeline(before, limit, all_spaces)` is one's own posts, the posts and reposts of the people one follows, and the top-level posts of the feed channels of **every space one is in** — or, with `all_spaces` false (a site that sets `community.pinning`), only the spaces one has **pinned** — newest first, paged backwards by time. A reply appears only where the person it answers is also followed (a stranger's half of a conversation is noise), and muted people are left out. It runs as the reader, so the guards above do the filtering and the function adds no rule of its own. Nobody pins a space they are not in.

`network_notifications(before, limit)` lists likes and reposts of one's posts, follows of oneself, and replies to and quotes of one's posts, from people one can see and has not muted. `network_unread()` counts what arrived since `network_seen`.

**Where the spaces are on as well, the list is the community's** (`98-community.sql`). `community_notifications(before, limit)` is the network's list, the spaces' mentions (`space_activity`), the answers in threads one is in from anybody else (`space_replies_to_me` — a reply that names one is a mention and is not listed twice) and the events one said one is going to, from a day before each starts until it has been on an hour (`events_soon_for_me`) — newest first, each part read under its own module's rules, so a reader outside a sold network's read grant still has the spaces' part. `community_unread()` counts all of it against the same `network_seen`, so opening the list clears everything at once; the header and the navigation show that one count (`nav.js` reads it where the spaces are on). In the column the list folds the likes and reposts of one post, and the follows, into one row each ("Ada and 3 others liked your post", `groupNotes` in `network/model.js`), tints what arrived since the last look, and filters by tab — All, Mentions, Replies, Likes, Follows, Events, each shown only where its module is on; a space's row opens its room or thread and an event's its page. The words are `## notes` in `network.md`.

Counts — likes, reposts, replies, quotes — are columns on the post kept by triggers, read as counts and never as rows.

## Moderation

The network belongs to no space, so it is moderated by the site's administrators. The acts are the community's, written to `network_moderation` and never edited or deleted, even by a moderator:

| act           | how                                          | what happens                                                                              |
| ------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| report        | `network_report(post, person, reason, note)` | any member, once per post or person                                                       |
| remove a post | `network_remove_post(post, reason)`          | nobody but its author and the moderators reads it; reports on it are answered             |
| suspend       | `network_suspend(person, until, reason)`     | they cannot post, like or follow, and nobody else reads what they wrote                   |
| lift          | `network_lift(act, reason)`                  | a row of its own pointing at the suspension; lifting a report closes it with nothing done |

Nothing is decided by a machine.

In the admin, **Community → Network** is where an administrator answers them: **Reports**, every report not yet answered with the post as its author wrote it (a moderator reads a removed one too), who reported it and why, and three answers — remove the post, suspend its author for a day, a week, a month or until lifted, or dismiss it; and **Suspended**, every suspension still in force, with who made it and until when, and Lift.

## The tables

Everything here is state — rows people made — and nothing is projected from a file (`93-network.sql`):

| table                                                                 | what it is                                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `network_posts`                                                       | a post: its text, audience, pictures and videos (`media`), what it answers, its counts, and `record` — everything else in the atproto record's own shape |
| `network_likes`, `network_reposts`                                    | a like or repost of a post here, or (for a joined member) one elsewhere by its URI                                                                       |
| `network_follows`                                                     | a follow of a member, or (for a joined member) of somebody elsewhere by DID                                                                              |
| `network_blocks`, `network_mutes`                                     | a block (a record) and a mute (a private preference)                                                                                                     |
| `network_pins`                                                        | which spaces somebody runs through their timeline                                                                                                        |
| `network_seen`                                                        | when somebody last read their notifications                                                                                                              |
| `network_moderation`                                                  | every act of moderation                                                                                                                                  |
| `network_identities`                                                  | the portable identity of a member who joined the wider network                                                                                           |
| `network_app_passwords`, `network_sessions`, `network_login_attempts` | how another app signs in                                                                                                                                 |

The `at://` URI and the CID of a record are never stored: both are computed from the author's identity as it is now, so joining the wider network, which changes a member's DID, rewrites nothing.

## Testing

`build/network-db.test.mjs` runs against the local stack, in `npm test` while the module is on: three posts and three readers by every path, a reply or quote wider than its post refused, the counts, the timeline (follows, reposts, pinned spaces, paging, mutes), notifications and their unread count, a block both ways, a closed page answering as a name nobody holds, every act of moderation, and Who to follow (`network_suggestions`: it answers, it suggests somebody with a page the reader does not follow, and never somebody they muted). It removes everything it made. `build/community-notes-db.test.mjs`, while the spaces are on too, holds the one list: a mention and a like in it with a count of two that opening clears, thread replies, a reply naming one listed once, a stranger to the room seeing none of it, and an event coming in the day before.
