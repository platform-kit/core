---
title: The Matrix API reference
description: Every endpoint, id shape, error code and table of the Matrix Client-Server API a site serves — the reference; the guide is under Building a site.
order: 85.9
sources:
  [
    packages/kit/supabase/functions/matrix-api/index.ts,
    packages/kit/supabase/functions/_shared/matrix,
    packages/kit/supabase/schemas/91-matrix.sql,
    packages/kit/supabase/functions/_shared/api/keys.ts,
    packages/kit/build/matrix-api.test.mjs,
  ]
reviewed: 2026-10-21
---

The guide is [The community as a Matrix homeserver](/content/docs/building-a-site/matrix-api). This page says exactly what is there. Modules: `spaces` and `api`; with either off nothing answers.

## Endpoints

All under the site's own host. A client that reads `/.well-known/matrix/client` finds the same address.

| Method                 | Path                                                          | What                                                                                           |
| ---------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET                    | `/_matrix/client/versions`                                    | the specification versions spoken                                                              |
| GET                    | `/_matrix/client/v3/login`                                    | the flows — `m.login.password` and nothing else                                                |
| POST                   | `/_matrix/client/v3/login`                                    | the site's own email and password; answers a token of ours                                     |
| POST                   | `/_matrix/client/v3/logout`                                   | ends our row and the auth server's session                                                     |
| POST                   | `/_matrix/client/v3/logout/all`                               | the same                                                                                       |
| POST                   | `/_matrix/client/v3/register`                                 | refused, with where to sign up instead                                                         |
| GET                    | `/_matrix/client/v3/capabilities`                             | and what is absent, each with its reason                                                       |
| GET                    | `/_matrix/client/v3/account/whoami`                           | the person and the device                                                                      |
| GET                    | `/_matrix/client/v3/devices`                                  | this account's Matrix clients                                                                  |
| GET                    | `/_matrix/client/v3/sync?since=`                              | the rooms, the timeline, the state                                                             |
| GET                    | `/_matrix/client/v3/joined_rooms`                             | the rooms and Spaces that are theirs                                                           |
| GET                    | `/_matrix/client/v3/rooms/{id}/messages?from=&dir=&limit=`    | paging, both directions                                                                        |
| PUT                    | `/_matrix/client/v3/rooms/{id}/send/{type}/{txn}`             | a message, a thread reply, an edit                                                             |
| PUT                    | `/_matrix/client/v3/rooms/{id}/redact/{event}/{txn}`          | a withdrawal                                                                                   |
| GET                    | `/_matrix/client/v3/rooms/{id}/state`                         | the room's state events                                                                        |
| PUT                    | `/_matrix/client/v3/rooms/{id}/state/{type}/{key}`            | **refused** — see below                                                                        |
| GET                    | `/_matrix/client/v3/rooms/{id}/members`                       | the space's members                                                                            |
| GET                    | `/_matrix/client/v3/rooms/{id}/joined_members`                | the same, as a map                                                                             |
| PUT                    | `/_matrix/client/v3/rooms/{id}/typing/{user}`                 | the typing stamp                                                                               |
| POST                   | `/_matrix/client/v3/rooms/{id}/receipt/{type}/{event}`        | where this client has read to                                                                  |
| POST                   | `/_matrix/client/v3/rooms/{id}/read_markers`                  | the same                                                                                       |
| GET                    | `/_matrix/client/v3/profile/{user}`                           | the display name                                                                               |
| GET                    | `/_matrix/client/v1/rooms/{id}/hierarchy`                     | a Space and the channels in it, so a client draws the site's arrangement                       |
| GET                    | `/_matrix/client/v1/rooms/{id}/relations/{event}[/{type}]`    | a thread's replies                                                                             |
| GET                    | `/_matrix/client/v3/pushrules/`                               | an empty ruleset: this site notifies its own way                                               |
| POST                   | `/_matrix/client/v3/user/{id}/filter`                         | accepted, never applied — a sync here is already only theirs                                   |
| GET                    | `/_matrix/client/v3/user/{id}/filter/{id}`                    | the empty filter back                                                                          |
| PUT                    | `/_matrix/client/v3/user/{id}/account_data/{type}`            | taken and dropped: a reader's settings are the site's                                          |
| POST                   | `/_matrix/client/v3/keys/upload`                              | the device's public keys and its one-time keys, with the real counts back                      |
| POST                   | `/_matrix/client/v3/keys/query`                               | the devices and cross-signing keys of people sharing a room                                    |
| POST                   | `/_matrix/client/v3/keys/claim`                               | a one-time key, claimable exactly once; the fallback when they run out                         |
| POST                   | `/_matrix/client/v3/keys/device_signing/upload`               | the three cross-signing keys, stored and served                                                |
| POST                   | `/_matrix/client/v3/keys/signatures/upload`                   | signatures merged in, and only the caller's own                                                |
| PUT                    | `/_matrix/client/v3/sendToDevice/{type}/{txn}`                | queued per device, delivered in the next sync                                                  |
| GET\|POST\|PUT\|DELETE | `/_matrix/client/v3/room_keys/*`                              | the key backup: version, store, fetch, and delete a version — `M_NOT_FOUND` until there is one |
| GET                    | `/_matrix/client/v3/thirdparty/protocols`                     | empty: no bridges                                                                              |
| GET                    | `/_matrix/media/v3/config`, `/_matrix/client/v1/media/config` | the largest file taken                                                                         |
| POST                   | `/_matrix/media/v3/upload`                                    | into the site's own bucket; 10 MB                                                              |
| GET                    | `/_matrix/media/v3/download/{server}/{id}`                    | signed as the person, so a room they cannot read refuses                                       |
| GET                    | `/_matrix/client/v1/media/download/{server}/{id}`             | the same, fetched with the token as a current client does                                      |

## Identifiers

A uuid with its hyphens removed, behind one letter that says what it names, at the site's host. Total and reversible, with no table of correspondences to go out of step.

| Thing     | Shape                                            |
| --------- | ------------------------------------------------ |
| a channel | `!c<32 hex>:host`                                |
| a space   | `!s<32 hex>:host`                                |
| a person  | `@<32 hex>:host`                                 |
| a message | `$m<32 hex>` — no host, as room version 4 onward |

The sync token is base64 of `channel:seq` pairs — `space_messages.seq`, which the timeline is already indexed by.

## State a client may not set

A `PUT` to any of these is refused by name, because each is the site's decision and a client that could set one would be a second, weaker way to make it.

`m.room.power_levels` · `m.room.name` · `m.room.topic` · `m.room.avatar` · `m.room.join_rules` · `m.room.history_visibility` · `m.room.encryption` · `m.space.child`

Power levels are **derived** from `space_grants`: 0 a member, 25 `voice` · `file` · `invite` · `mention-channel`, 50 `moderate` · `announce`, 100 an administrator.

## Error codes

Every refusal carries Matrix's `errcode` and an `error` sentence naming the reason — never a bare code.

| Code               | When                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `M_MISSING_TOKEN`  | no access token on the request                                                                                           |
| `M_UNKNOWN_TOKEN`  | not ours, signed out, or the account ended the session                                                                   |
| `M_FORBIDDEN`      | wrong password; not in the room; read-only state; registration; encryption; a key of the wrong kind or without the grant |
| `M_LIMIT_EXCEEDED` | past the sign-in cap, with `retry_after_ms`                                                                              |
| `M_NOT_FOUND`      | no room with that id here                                                                                                |
| `M_TOO_LARGE`      | a file past the limit                                                                                                    |
| `M_BAD_JSON`       | a body this endpoint cannot read                                                                                         |
| `M_UNRECOGNIZED`   | an endpoint this server does not implement                                                                               |

## Tables

| Table                   | What                                                                   | Policies                                                   |
| ----------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| `matrix_sessions`       | a client's token hash, its device, and the auth server's refresh token | RLS on, **no policies** — only the service role reaches it |
| `matrix_read`           | where a Matrix client has read to, per room                            | the person's own                                           |
| `matrix_login_attempts` | the sign-in cap's counter                                              | the service role's                                         |

`matrix_session_claim(hash)` takes the row `for update`, so two requests cannot spend one refresh token at once.

## Keys

A key of kind `matrix`, made under Settings → API, is for a script or a bridge: it acts as the key's maker and reaches what it is granted. A key of any other kind is `M_FORBIDDEN`. No key reaches the coaching chat or the support desk.

## What a client insists on, and what it is told

Several endpoints above look optional and are not: a client will not finish starting up, or will
not draw a room, until each of them answers. They were found by pointing a real client at a
running site rather than by reading the specification, and each answer is a true statement about
this site rather than a stub:

- **Push rules** — an empty ruleset. A client will not begin syncing without one, and this site
  notifies through its own channels, which know about memberships and the desk and work when no
  Matrix client is open.
- **A filter** — accepted, never applied. A filter asks for less than everything; a sync here is
  already only what that person may see, so there is nothing to cut.
- **Device and cross-signing keys** — a real key store, where the `space-encryption` module is on.
  A channel whose file says `encrypted: true` is served with `m.room.encryption` in its state, and a
  client seeing that seals every message it sends there — so a client that could not store or fetch
  a key could not send at all. What is stored is public keys and opaque blobs, never a secret.
  With the module off these answer as they did before there was any such thing: taken, kept by
  nobody, counts of zero, which a client reads as "no encrypted rooms" and which is then true.
- **Key backup** — the reader's own sessions, sealed under a recovery key the site has never seen.
  `M_NOT_FOUND` until there is a backup, which is a client's ordinary first day, rather than "not
  implemented", which reads as a server too old to ask. A version can be deleted (Element calls it
  "delete backup"); the row is marked rather than removed, since the sessions in it may be the only
  copy of keys somebody still wants.
- **Sending and reading in a sealed room** — a client sends `m.room.encrypted` and it is stored as
  the row's ciphertext; a sealed row is served back as `m.room.encrypted` and not as a message with
  no words. The two refusals are the other way round from everywhere else: a ciphertext into an open
  room is refused, and so is a plain message into a sealed one — the second would be words in a
  timeline everybody else is sealing, with nothing about the room to show it.
- **To-device messages** — how a room key reaches another device at all. A batch is deleted on the
  NEXT sync rather than the one that delivered it, which is Matrix's own contract: a client that
  dies mid-sync sees its keys again instead of losing them for good. The sender on each is a Matrix
  id: handed the account's own uuid instead, a client cannot match the message to the sender it
  claims, drops the room key, and reads "the sender's device has not sent us the keys for this
  message" for ever — while the site's own client, which translates the id itself, reads the room
  perfectly.
- **An unimplemented endpoint** — `M_UNRECOGNIZED` with 404, never 401. A 401 says the endpoint
  exists and the token is wrong, which is the opposite of the truth, and a client probing for an
  optional feature cannot tell the two apart.
- **No `well_known` on the login answer.** A client moves its base address to whatever that field
  says, and this surface cannot state it correctly — it sees the address the request arrived on
  inside the stack, not the one the browser used, and behind a site's own rewrite neither is
  right. Saying nothing leaves the client where it already is, which is correct everywhere.

## Pointing Element at a site

Element Web works against a site: sign in with the email and password of the site's own account,
and the Spaces, channels, people, threads and withdrawals are the site's own. Two things to know.
Element offers to set up encryption keys on first sign-in. Where the site seals no channel there is
nothing to set up, so say **Later** — and a deployment that would rather not be asked at all can set
`"io.element.e2ee": { "force_disable": true }` in Element's `config.json`. Where a channel IS sealed,
set the keys up: Element will not send into an encrypted room without them, and the recovery key it
shows is the one thing the site cannot show again, because the site never had it. And a site's channels
appear **inside its Space**, not under Home, because that is where they belong.

**A picture does not yet draw in Element.** The event is well formed — mimetype, size, width,
height — and the bytes are served correctly to anything that asks with the token, over both the
old address and the authenticated one. Element makes no request for it and renders an error in
its place; the cause has not been found, and advertising the specification version that moved
media behind the token changed nothing. Pictures work in the site's own client. This is the one
part of this surface that a real client does not yet show.

## Not implemented, on purpose

Federation, end-to-end encryption, presence, VoIP, and slash commands — each refused with a reason rather than left to fail. The guide says why.
