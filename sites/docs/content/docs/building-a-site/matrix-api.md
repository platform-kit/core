---
title: The community as a Matrix homeserver
description: The site's spaces and channels served as Matrix's Client-Server API, so Element and every other Matrix client works against it — how it is built, how a session stays the person's own, and what is deliberately absent.
order: 56.99
sources: [packages/kit/supabase/functions/matrix-api, packages/kit/supabase/functions/_shared/matrix, packages/kit/supabase/schemas/91-matrix.sql, packages/kit/build/matrix-api.test.mjs]
reviewed: 2026-10-02
---

The community — spaces, channels, threads, direct messages — is served as a **Matrix homeserver's Client-Server API**. Element, FluffyChat, Nheko, Cinny and every other Matrix client signs in and reads the site's rooms with the host swapped, on iOS, Android, macOS, Windows and Linux, without this platform shipping an application of its own. Modules: `spaces` and `api`.

It is the same move the Chatwoot, Shopify, cal.com, Typeform and Contentful surfaces are, and it earns its keep the same way: **nothing about the data changes**. A channel is already a room, a message row is already an event with an ordering, and a space is already Matrix's own idea of a Space.

## The tables are the store; Matrix is a view of them

There is no event graph, no room DAG, no state resolution, no second copy of a message.

| Matrix | Here |
| --- | --- |
| room | a `channels` row |
| Space | a `spaces` row, its channels the children |
| event id | the message's own id |
| sync position | `space_messages.seq`, per channel |
| `m.room.message` | a message of kind text, voice or file |
| thread | `thread_root_id` |
| replacement (an edit) | `edited_at` on the row |
| redaction (a withdrawal) | `deleted_at` on the row |
| membership | `space_members` |
| power levels | derived from `space_grants`, and read-only |

The parts of Matrix that are hard — state resolution, the event DAG, signing — exist to reconcile *several* homeservers. With one they are not needed, and building them would be building a distributed database to serve a Postgres table that is already right.

`seq` already exists, is per channel and monotonic, and is what the site's own client pages by. It is therefore the sync token, which means `/sync` is a query the database already has an index for.

## Every request is served as the person

This is the whole security argument, and it is worth reading before changing anything here.

Every community read is a `SECURITY DEFINER` function ending at `can_read_channel`, which asks `auth.uid()` — there are eighty-five such checks in the spaces schema. **So the service role reads nothing**: `auth.uid()` is null for it and the gate answers false. A function holding the service key cannot over-read this data by accident; it can only fail. The one way to serve Matrix at all is to genuinely be the person.

So a Matrix access token is a token of **ours**, opaque to the client, backed by a session the auth server issued:

1. `/login` verifies the password through the site's own sign-in and keeps the **refresh token**.
2. Each request exchanges that for a short-lived access token and builds a client carrying it.
3. `auth.uid()` is then the person, and every guard applies with nothing re-implemented.

**Minting our own JWT was rejected**, and the reasons are worth keeping: the project has no such secret, so it would be a new one to hold and rotate; a function that can sign a session can forge *any* identity, which is a far larger thing to protect than a token table; and a minted token outlives the account's own decisions, so revocation would become this surface's problem to reimplement — the same mistake as reimplementing the read rules.

Keeping the auth server's own session means **revocation belongs to the account**. A password change, a ban or a sign-out-everywhere ends every Matrix client of that person without this surface being told anything.

What it costs is a refresh token at rest. It lives in `matrix_sessions`, which has **RLS on and no policies at all** — so nothing but the service role reaches it — and it is rotated under a row lock (`matrix_session_claim`, `for update`) so two requests arriving together cannot spend it twice. The service role is used for two things and no others: checking a password and reading that table.

`/login` is capped per address per hour, over whatever the auth server already imposes, and the refusal says so in Matrix's own error shape.

## What a client may not set

A room's name, its topic, its picture, who may join, what an arriving member may read, which rooms a Space holds — and **power levels** — are the site's, and a `PUT` to any of them is refused by name. Letting a client set a power level would put a second, weaker way to grant moderation beside the one the admin uses, and it is the weaker one an attacker would reach for. A moderator added in the admin appears on the next sync; nothing on this surface can add one.

The numbers are the conventional ones, so a client's own interface behaves the way its users expect: 0 a member, 25 may attach or speak, 50 a moderator, 100 an administrator.

## Bots

A bot named in a message is asked by the **database**, not by the client that wrote the line — `trg_agent_hear_mention` on `space_messages`, which makes every refusal `agent_summon` already made. So mentioning a bot from Element works exactly as mentioning one in the site's own composer does. See [Bots](/content/docs/building-a-site/bots).

**Slash commands are absent from this surface**, deliberately. Their arguments are drawn as controls and their prompt is the file's; a third-party client could only send `/name a b c` as words, which is the grammar-typing this platform refuses everywhere, and Matrix clients swallow some names before they are ever sent. A body beginning with a slash is an ordinary message and nothing is parsed out of it. Mentioning a bot is how somebody there asks it for something.

## Deliberately absent, and why

- **Federation.** The site is a homeserver for its own people, not a node on the public Matrix network. That would need signing keys, a server-to-server surface and state resolution. A client asking for a room on another host is refused with a message naming the reason rather than timing out.
- **End-to-end encryption, unless a channel asks for it.** The site reads its own rooms for search, moderation, the desk and its bots, so a room is unencrypted by default and a client saying so is telling the truth. A channel whose file carries `encrypted: true` is the other case: it is served with `m.room.encryption`, every key endpoint is real, and the site gives up all four of those things in that room — there is no search of it, no bot in it, and no moderating what nobody can read. That is the whole trade, which is why it is a module of its own (`space-encryption`) and not something the community switch turns on.
- **Presence.** Matrix's presence is a firehose and the community has no such concept.
- **VoIP.** A huddle is the site's own video, behind the video seam; a Matrix call would be a second one.
- **The coaching chat and the support desk.** Different privacy rules and their own surfaces already — the desk is served as [Chatwoot's](/content/docs/building-a-site/support-api). Putting a member's coaching thread in the same client as a public room is exactly the mistake the separate tables were made to prevent.

## Pointing a client at it

The homeserver address is the site's own. In Element, *Sign in* → *Edit* the homeserver → the site's URL; then the email and password of a site account. A client that reads `/.well-known/matrix/client` finds the same address.

A key of kind `matrix`, made under Settings → API, is for a script or a bridge: it acts as the key's maker, reaches what it is granted, and is refused elsewhere. No key reaches the coaching chat or the desk, which are not this surface.

## Testing

`platformkit test` runs the translation — ids, events, state and every refusal — as pure functions under Node, which needs no stack. With a stack up it drives **`matrix-js-sdk`**, the library Element itself is built on, against the served function; with none it skips, naming what it did not cover. The point of the surface is that real clients work, and a test that speaks the protocol by hand proves only that our own reading of the specification is self-consistent.
