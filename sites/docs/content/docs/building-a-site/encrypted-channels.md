---
title: Encrypted channels
description: A channel the server cannot read — what it costs, how a room is sealed, where the keys live, and what goes dark.
order: 56.45
sources: [packages/kit/supabase/schemas/92-encryption.sql, packages/kit/supabase/functions/_shared/matrix/keys.js, packages/kit/build/encryption.test.mjs, packages/kit/build/encryption-db.test.mjs, packages/kit/build/modules/kit.mjs, packages/kit/build/spaces-io.mjs, packages/kit/build/spaces.mjs, packages/kit/build/spaces-push.mjs, packages/kit/supabase/functions/matrix-api/index.ts, packages/kit/supabase/functions/_shared/matrix/state.js, packages/kit/src/lib/spaces/crypto.js, packages/kit/src/lib/spaces/api.js, packages/kit/src/lib/spaces/audio.js, packages/kit/src/lib/spaces/model.js, packages/kit/vite/index.mjs, packages/movable-types/src/components/spaces/SpaceSealSetup.vue, packages/movable-types/src/content/ui/spaces.md]
reviewed: 2026-10-10
---

A channel can be **end-to-end encrypted**: the ciphertext is the only copy the site has, and every
reader holds a key the server never sees. It is its own module, `space-encryption`, and it is off
nowhere and on nowhere by accident — read what it costs before switching it on.

## What it costs, which is the first thing to know

A sealed room is not a better room with a padlock on it. It is a room with four things taken out,
and all four are things a site usually wants:

- **No search.** Nothing can index words nobody can read. Search says so rather than returning
  nothing, and names how many rooms it could not look in.
- **No bots.** A bot would have to read the room to answer in it. The admin does not offer a sealed
  channel when a bot is being placed, and the build refuses one that names it.
- **No moderating what was said.** A report from a sealed room reaches the staff with the room and
  the person on it and no words at all. Every action still works — a member can be muted, removed,
  shadow-banned — because those are acts against a person and not against a message.
- **No history for somebody who arrives.** A member who joins reads the room from the moment they
  joined. The keys to what came before are on other people's devices and nobody here can hand them
  over. The timeline says so where it begins.

A site that wants rooms should not have to take that bargain to get them, and a site that wants it
should take it deliberately. That is the whole reason the switch is separate from `spaces`.

## Sealing a room

`encrypted: true` in a channel's own file, or in the space's to seal every room under it:

```yaml
# content/spaces/the-guild.md
name: The Guild
kind: community
encrypted: true          # every room under it, unless a room says otherwise
```

```yaml
# content/spaces/the-guild/open-house.md
name: Open house
encrypted: false         # …and this one is not
```

`encryptedOf` in `build/spaces-io.mjs` is the one reading of the two: the channel's own answer where
it gives one, the space's otherwise. A channel that says nothing is **not** `false` — it is
"whatever my space says", which is what lets one line seal a space and one line let a room back out.

Switching the module off while a file still asks for a seal is a **fault at the compile**, naming
the module and the file. A room that is sealed in the repository and plain text in the database,
with nobody told, is worse than either a sealed room or an open one. In local development, edits to space or channel Markdown rerun the matching compile and safe local projection; failures stop the refresh instead of being treated as an empty declaration.

## The seal only comes off while there is nothing behind it

Turning `encrypted` off would make the room readable from now on and leave every message already in
it a ciphertext nobody will ever decrypt again, because the clients stop asking: a timeline of
"cannot read this" with no way back. A trigger refuses it the moment the room holds a sealed
message. Before that — a site that switched it on by mistake and caught it the same afternoon — it
is free, and allowed.

## Where the keys live

Nowhere the site can read them. Four tables hold what is needed and every one is **state**, not a
declaration: a device is an act, somebody signing a client in on a laptop.

| table | holds |
| --- | --- |
| `space_devices` | a person's devices and their **public** identity, signing and cross-signing keys |
| `space_one_time_keys` | public keys a correspondent claims to start a session, each claimable exactly once |
| `space_to_device` | a room key on its way between devices, queued and deleted once delivered |
| `space_key_backups` | the reader's own sessions, sealed under a recovery key the site has never seen |

Drop all four and every reader sets a device up again and the messages already sealed become
unreadable — which is the guarantee **working** rather than the guarantee failing. There is no file
anywhere that could bring a private key back, because there is no file anywhere that ever had one.

The fence on the devices is the rooms: a reader learns the public keys of people they share a space
with, and nobody else, so the table is not a directory of everybody who ever signed up. Claiming a
one-time key goes through the database (`space_claim_otk`), which picks its row inside the delete —
two callers racing for the last key leave one empty-handed rather than both holding the same one.

Two of the things a client must do cannot be done under the policies at all, and each has a door of
its own. **Claiming somebody else's one-time key is a delete of their row**, and **queueing a room
key into their device is an insert into their queue** — a client that could do either could empty a
stranger's keys, or deliver a forged room key that looked exactly like a real one. So
`space_claim_key` and `space_send_to_device` are security-definer functions with the same fence the
device table has: yourself, or somebody you share a space with. A stranger gets nothing and is told
nothing, and the sender on a queued message is taken from the session rather than from the body. A
signed-in account is not automatically a stranger: space fills may already put it in a room with
the target, so the fence is shared membership rather than account status.

## Reading a sealed room in the site's own interface

The site is a Matrix client like any other, and holds its own device keys. All of the cryptography
is in **one module**, `src/lib/spaces/crypto.js`, and nothing else in the project does anything
cryptographic — a check reads the files and fails if any other one so much as names the library or
a key table, because a second place that knew how to seal would be a second place that could get it
wrong without anything looking broken.

That module is the **transport** for `matrix-sdk-crypto-wasm`, the same Rust library Element runs:
the library says what requests it needs made, the module makes them against the site's own tables,
and hands the answers back. Every decision about keys, sessions and ratchets belongs to the library.
It is imported on demand the first time a sealed room is opened, so no unencrypted route pays for a
megabyte of WebAssembly.

### A device, not an account

A device is a **browser**. Two browsers of one person are two devices with two sets of keys, which
is exactly why a sealed room on a new machine cannot read what came before. Opening a sealed room
publishes this browser's keys and, the first time, makes the account's cross-signing identity.

The panel above the composer asks for one thing at a time, and nothing else in the room changes:

- **Set this device up** — this browser has no keys in it yet.
- **Your recovery key** — shown once, at the one moment it exists outside the library's own store.
  Nothing writes it down: not a row, not `localStorage`, not a log. When the reader says they have
  it, it is gone from the page and nothing here can show it again.
- **Read your earlier messages** — this browser is set up and the account has a history it cannot
  open. A wrong key is answered with a sentence and changes nothing.
- **Carrying on without it** — the messages sent before this device existed stay sealed, and
  everything from now on is readable here. Both halves of that are true and the second is the one
  most easily got wrong: a design where the key were needed for new messages too would lock a
  reader out of their own rooms on a new laptop.

### What the recovery key carries

Matrix's key backup, and one thing more. The reader's room keys are sealed to the backup's public
half and kept in `space_key_backups`; beside them, sealed under the recovery key itself with
WebCrypto's own AES-GCM over an HKDF-derived key, are the account's **cross-signing private keys**.
Without those a new browser is a device the account has never signed. The row holds the ciphertext
and the backup's public half and nothing that opens either.

## What the row actually holds

The ciphertext, the algorithm, the sender key and the session id, in `space_messages.cipher`.
`body`, `title` **and `attachment_name`** are null, and that third one is the point:
`space_messages.fts` is generated over exactly those three, so the full-text index holds nothing
and search misses the room for free. Were the attachment's name written, "severance-agreement.pdf"
would be findable in a room whose words nobody can read — the kind of half-guarantee that reads as a
bug and is one. A check constraint refuses a row carrying a cipher and any of the three together.

## Files and voice notes are sealed too

It would be no use sealing the words and leaving the picture, the recording, and above all the file
**name** in the clear beside them — "severance-agreement.pdf" says most of what the message said.

So they are not. Matrix's own scheme, and the library's own implementation of it: the bytes get a
key of their own, and what the bucket holds is ciphertext and nothing else. The little key that
opens it travels **in the message**, sealed to the room like any other words, along with the name,
the type, the length and anything said with it. The row carries the path in the bucket and the
cipher, and nothing else.

To the reader none of this shows. A voice note plays, a picture appears, a pdf downloads — the file
is fetched, opened and handed on as a blob before anything above it knows there was a difference,
which is what a room being sealed is supposed to cost somebody: nothing they can see.

## Matrix clients

A sealed channel is served with `m.room.encryption` in its state, so Element and the rest encrypt
everything they send there and refuse to send a plain message — which is what we want, since a
client that did not know would post the plaintext into a room everybody else is sealing. Every key
endpoint is real: upload, query, claim, cross-signing, signatures, to-device, and the key backup.
See the [Matrix API reference](/content/docs/reference/matrix-api).

Set the keys up when Element offers, rather than saying Later: it will not send into a sealed room
without them, and the recovery key it shows is the one thing the site cannot show again.

## Where a sealed room says so

A shield, beside the room's name, in the four places a channel is named:

- **the rail**, after the name — not in the lock's slot. Private says who may come in; sealed says
  what the site can read, and a room is often both, so swapping the glyph would lose one of them.
- **the room's header**, beside the name of the room somebody is reading.
- **search's "In" list**, where the room stays listed and cannot be chosen. Dropping it would leave
  a reader hunting for a room they know is there; offering it would let them search a room that is
  guaranteed to find nothing and read that as the search being broken. A select carries no glyph,
  so the reason is in the label.
- **the admin's room card** — shown, never set. The seal is one-way once the room has used it, so a
  switch in a form would be a control that silently stops working; it is `encrypted:` in the file.

The admin asks `encryptedOf` like everything else. It lives in `src/lib/spaces/model.js` — the
browser-safe one — because the admin needs it too, and `build/spaces-io.mjs` re-exports it: a second
copy of a two-line rule is how the admin comes to show a different answer from the room.

## Nothing is announced by a toast

Each of the states above is a **line in the surface the person is looking at**, still there when
they look again: the history line where the timeline begins, the search line beside the result
count, the report line where the words would be, and the bot form that does not offer the room at
all. A toast is for something that just happened and is over; none of these is over, and a person
who missed one has no way to ask for it again. The words are the `## encryption` group of
`content/ui/spaces.md`.
