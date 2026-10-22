---
title: The atproto API reference
description: Every method, identity path, token and refusal of the atproto server a site with the social network serves — the reference; the guide is under Building a site.
order: 85.95
sources:
  [
    packages/kit/supabase/functions/atproto/index.ts,
    packages/kit/supabase/functions/_shared/atproto,
    packages/kit/build/atproto.test.mjs,
    packages/kit/src/lib/network/apps.js,
    packages/kit/theme/src/components/network/NetApps.vue,
    deploy/_redirects,
    packages/kit/vite/index.mjs,
    packages/kit/supabase/functions/_shared/atproto/federation.ts,
    packages/kit/supabase/functions/_shared/atproto/appview.ts,
    packages/kit/build/atproto-interop.test.mjs,
  ]
reviewed: 2026-10-21
---

The guide is [The social network](/content/docs/building-a-site/social-network). This page says exactly what is there. Module: `network`; with it off the function answers every request with `MethodNotImplemented` and the host carries none of its rewrites.

## Where it answers

An atproto client asks for `/xrpc/<method>` at the **root** of the host it was given and resolves a handle at that host's `/.well-known`, so the site's own address answers them:

| path                       | rewritten to (deploy/_redirects)                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `/xrpc/*`                  | `$SUPABASE_URL/functions/v1/atproto/xrpc/:splat`                                             |
| `/.well-known/atproto-did` | the function, which reads the host it was asked on                                           |
| `/.well-known/did.json`    | the same: a member's `did:web` document on their handle's host, the site's own on the site's |

The dev server proxies the same three paths to the function (the kit's Vite plugin). The function's own address is not one a client can use: a client discards any path on the server it is given.

## Other apps are the site owner's choice

Other apps signing in is off unless the site's config says `network: { apps: true }`. Off, every method an app would use — `com.atproto.server.createSession`, `refreshSession`, `createAppPassword`, every `app.bsky.*` read and write, a space's feed generator — answers 403 `Forbidden`, "This site does not let other apps sign in. Use the site itself." (`clientAllowed` in `_shared/atproto/ids.js`, pinned by `build/network.test.mjs`). What still answers: `com.atproto.server.describeServer`, which the site's own account page reads, and, where the site federates, `com.atproto.sync.*`, `com.atproto.identity.resolveHandle` and the public repository reads (`describeRepo`, `getRecord`, `listRecords`), which relays and other servers need.

## Identity

|                    |                                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| handle             | `<name>.<NETWORK_HANDLE_DOMAIN>`, where the name is the member's username — or, until they take one, `m` and the last twelve hex of their id. A username always wins. Atproto reserves `.localhost`, so a local stack uses a domain such as `network.test` |
| DID                | `did:web:<handle>` (`%3A` for a port); a member who has joined the wider network has a `did:plc` instead                                                                                                                                                   |
| the site's own DID | `did:web:<the site's host>` — the server a space's feed generator names                                                                                                                                                                                    |
| a record's URI     | `at://<did>/<collection>/<rkey>`, never stored: made from the author's identity as it is now                                                                                                                                                               |
| a space's post     | `at://<author did>/app.bsky.feed.post/s~<message id, hex>` — no record of anybody's; the key says so                                                                                                                                                       |

`network_user_of_name` (service role only) answers whose a handle name is; `network_people` gives a signed-in reader the handle name of everybody they can see.

## Signing in

A member signs another app in with an **app password**, never their own: made on their account page (Other apps), shown once, stored as a hash (`network_app_passwords`), revoked there — which ends every session made with it. `com.atproto.server.createSession` takes a handle, a DID or the member's address with an app password; it mints a session from the site's own auth server for that member (a sign-in link minted and redeemed at once, sent nowhere), so a ban, a password change or a sign-out everywhere ends it.

The two tokens are JWTs in shape (`scope`, `sub`, `aud`, `exp`; access two hours, refresh ninety days) and are never trusted for what they claim: a token is its hash in `network_sessions`. An expired access token answers `ExpiredToken` and the client refreshes. The site's own session is accepted too, which is how the account page makes app passwords. Ten wrong passwords from one address in an hour are refused with `RateLimitExceeded`.

## Methods

| method                                                                                                                     | what it does here                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `com.atproto.server.describeServer`                                                                                        | the site's DID and its handle domain; invite code required                                                                                                                                                                                                                                                                                                                                |
| `createSession` · `refreshSession` · `getSession` · `deleteSession`                                                        | as above                                                                                                                                                                                                                                                                                                                                                                                  |
| `createAppPassword` · `listAppPasswords` · `revokeAppPassword`                                                             | the member's own                                                                                                                                                                                                                                                                                                                                                                          |
| `createAccount`                                                                                                            | refused: accounts are made on the site, and the refusal says where                                                                                                                                                                                                                                                                                                                        |
| `checkAccountStatus`                                                                                                       | active                                                                                                                                                                                                                                                                                                                                                                                    |
| `com.atproto.identity.resolveHandle`                                                                                       | a handle on this site, to its DID                                                                                                                                                                                                                                                                                                                                                         |
| `updateHandle`                                                                                                             | refused: a handle is the username, changed on the account page                                                                                                                                                                                                                                                                                                                            |
| `com.atproto.repo.createRecord` · `putRecord` · `deleteRecord` · `applyWrites`                                             | the writer's own repository only; validated against Bluesky's lexicons                                                                                                                                                                                                                                                                                                                    |
| `getRecord` · `listRecords` · `describeRepo`                                                                               | under the same guards as every read                                                                                                                                                                                                                                                                                                                                                       |
| `uploadBlob`                                                                                                               | a picture (png, jpeg, gif, webp, up to 10 MB) or a video (mp4, webm, mov, up to 100 MB), named by its hash, kept in the `network` bucket under the member's id; a post's record carries up to four pictures (`app.bsky.embed.images`) or one video (`app.bsky.embed.video`), and a post holding more, or a mix, goes as its first four pictures with a link to the whole post in its text |
| `app.bsky.actor.getProfile(s)` · `searchActors(Typeahead)` · `getPreferences` · `putPreferences`                           | profiles with counts and where the reader stands; search among the people the reader can see (`network_find`); an app's own settings (`network_prefs`)                                                                                                                                                                                                                                    |
| `app.bsky.feed.getTimeline` · `getAuthorFeed` · `getPostThread` · `getPosts` · `getLikes` · `getRepostedBy`                | over the tables, as the reader                                                                                                                                                                                                                                                                                                                                                            |
| `getFeedGenerator(s)` · `getSuggestedFeeds` · `describeFeedGenerator` · `getFeed` · `getFeedSkeleton`                      | each space with a feed channel the reader belongs to, as a feed: its posts to a member, nothing to anybody else                                                                                                                                                                                                                                                                           |
| `app.bsky.graph.getFollows` · `getFollowers` · `getBlocks` · `getMutes` · `muteActor` · `unmuteActor` · `getRelationships` |                                                                                                                                                                                                                                                                                                                                                                                           |
| `app.bsky.notification.listNotifications` · `getUnreadCount` · `updateSeen`                                                | likes, reposts, follows, replies and quotes                                                                                                                                                                                                                                                                                                                                               |
| `app.bsky.labeler.getServices`, `app.bsky.unspecced.*`, lists and starter packs                                            | empty: the site has none                                                                                                                                                                                                                                                                                                                                                                  |
| `chat.bsky.*`                                                                                                              | not served: direct messages are the spaces'                                                                                                                                                                                                                                                                                                                                               |

What a record becomes:

| collection                                       | written as                                                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.bsky.feed.post`                             | a network post; its audience is everyone for a member who has joined the wider network and the people here for everybody else, since a client cannot ask. An answer to a space's post is a reply in that room |
| `app.bsky.feed.like`                             | a like; on a space's post, the room's own ❤️ reaction                                                                                                                                                         |
| `app.bsky.feed.repost`                           | a repost; a space's post cannot be reposted                                                                                                                                                                   |
| `app.bsky.graph.follow` · `app.bsky.graph.block` | a follow, a block                                                                                                                                                                                             |
| `app.bsky.actor.profile`                         | the display name and the line on the site's own profile                                                                                                                                                       |

A picture in a view is an address the reader's own session signed for an hour. A drawn face has no address, so an author without an uploaded picture shows the app's default.

## Where the site federates

|                                                                                                         |                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /network/join` · `POST /network/leave`                                                            | the member's own act, with the site's session (the account page's card); refused on a closed site                                                                                           |
| `com.atproto.sync.subscribeRepos`                                                                       | the event stream: every commit, identity and account event of a joined member, numbered (`network_seq`), from the relay's cursor, then live; a cursor ahead of the stream is `FutureCursor` |
| `getRepo` · `getLatestCommit` · `getRecord` · `getRepoStatus` · `listRepos` · `getBlob`                 | a joined member's public repository, to anybody; a record not in it is not found; a member who left or was suspended answers `RepoDeactivated` or `RepoTakendown`                           |
| a read about somebody elsewhere (a profile, an author's feed, a thread, posts, follows, likes, reposts) | asked of the app view (`network.appview`, Bluesky's by default) as the member, with a service token signed by their key; a member who has not joined is refused, saying why                 |
| `getTimeline`, `listNotifications`                                                                      | the first page merges the app view's with the site's own                                                                                                                                    |
| `POST /internal/project` · `POST /internal/crawl`                                                       | the service role only: the database asking for repositories to be made agree, and the daily crawl request                                                                                   |

A commit event carries the new blocks and the blocks its proofs pass through, and `prevData` (the tree's root before), so a relay verifies and inverts it from the event alone. The PLC directory is `NETWORK_PLC_URL` (`https://plc.directory` unless set); the relay `NETWORK_RELAY_URL` or the config's `network.relay`.

## Refusals

|                                                                             | error                                                           |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| a closed site asked for `com.atproto.sync.*` or service auth                | `MethodNotImplemented` — the network is closed                  |
| a closed site asked about somebody elsewhere                                | the same                                                        |
| a write to somebody else's repository                                       | `Forbidden`                                                     |
| a reply or quote wider than its post, across a block, by a suspended member | refused by the database, said as `InvalidRecord` or `Forbidden` |
| a record that is not its lexicon                                            | `InvalidRecord`                                                 |
| a method this site does not serve                                           | `MethodNotImplemented`                                          |

## Testing

`build/atproto.test.mjs` drives the served function with Bluesky's own client: app passwords, signing in by handle and address and refusing the site password, three posts and three readers by every method, a space's post by record, in a list and in a thread, a space's feed to a member and an outsider, the timeline, likes, reposts, replies, notifications, a picture uploaded and posted, a record read back, the closed site's refusals, and revoking an app password. It skips itself, saying why, when the function is not served.
