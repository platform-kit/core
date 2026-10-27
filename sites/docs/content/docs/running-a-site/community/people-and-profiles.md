---
title: A person's own page
description: What somebody is called, the face they wear, and the page at /p/<username> — private until they say otherwise.
order: 30
sources:
  [
    packages/kit/src/lib/account.js,
    packages/kit/src/lib/avatar.js,
    packages/kit/build/site-avatar-node.mjs,
    packages/kit/theme/src/pages/PersonPage.vue,
    packages/kit/theme/src/components/AvatarPicker.vue,
    packages/kit/theme/src/content/ui/account.md,
    packages/kit/build/admin-pipe.mjs,
    packages/kit/build/admin-fence.test.mjs,
    packages/kit/supabase/functions/admin,
    packages/kit/src/lib/auth.js,
    packages/kit/build/avatar.test.mjs,
    packages/kit/theme/src/components/spaces/SpaceAvatar.vue,
  ]
reviewed: 2026-10-26
---

Everything on this page is the person's own. It is written straight to their profile row under the policy that the row is theirs — no function, no approval — because none of it is a decision anybody else has a say in. The guard trigger refuses the columns that are _not_ theirs: their roles, the proof of their address, the Stripe customer.

## Nobody is given a face they did not choose

Somebody who has never opened their settings has a **pattern** — DiceBear's `patchwork`, drawn from a digest of their own address. Not a face.

That is deliberate and it is the whole rule. Every anthropomorphic style hands a person a face with a presentation: a hairstyle, a jaw, a beard. A presentation nobody chose can be wrong about the person wearing it, and being wrong about that is worse than being plain. A pattern says nothing and is still theirs alone — the same one on every device, for as long as they keep it.

What they may **choose** from is three, and they are the whole of what the bundle carries:

|               |                                                                |
| ------------- | -------------------------------------------------------------- |
| **Patchwork** | quilt shapes. The default, and the only one that is not a face |
| **Big smile** | a face                                                         |
| **Personas**  | a face                                                         |

Plus a picture of their own, which always wins. It goes in the public `avatars` bucket under their own id — `<uid>/face.<ext>` and nothing else, so the policy is a shape and not a list, and a name once taken is theirs. Public to read, because a face is shown wherever the person is and signing two hundred urls for a directory is two hundred signatures for something nobody is hiding.

### Designing one, part by part

**It is folded away until it is asked for.** Eight styles, a row for every part and eight seeds is the whole of a screen, and it sat at the top of the account page — so somebody who came to change their name scrolled past a face workshop to reach it. **All of it folds and none of it is taken away**: what stays out is the face they have and **Upload a picture**, and **Design a face** opens everything that changes the face.

The fold's control carries a drawn chevron as well as its label, which is not decoration. The label is a string like every other, and a string a build has not compiled yet resolves to nothing — on a text-only button that is a control zero pixels wide, so the designer sits behind something nobody can see or press and the page reads as though the customisation had been deleted. With the chevron the fold is always openable, whatever the words do.

A seed gives somebody a face they did not choose. The designer is the other half: every part a style offers, each shown as **a picture of the face with that option applied**, because a choice you can see is worth more than a choice you have to read.

What a style offers is read from the style's own definition — its components (the hair, the eyes, the mouth, what they are wearing) and its colour palettes — so nothing is a list anybody keeps in step, and a style that gains a part next release gains it in the picker too. Personas alone offers twenty hairstyles and four palettes.

**One part at a time, large.** Laid out as a row of small squares, the difference between two mouths or two pairs of glasses is a few pixels across — the form was unreadable, which made it unusable. So each part is a single square big enough to see with a step either way, and **Show all options** lays the whole row out for somebody who would rather scan it. **Reset to default** gives that part back to the seed.

**The order is the order a face is built in**, from the skin outward — not the order a style definition happens to list its components in, and not shapes-then-colours, which asks four questions about things drawn on top of the skin before asking what colour the skin is. `traitRows` in `lib/avatar.js` declares it per style; a part a style has that is not named there follows, so a style that gains one is handled the day it ships.

**A colour is never a carousel.** Stepping through eight browns one at a time to find a skin tone is a worse form than seeing all eight at once, and neither lets somebody have the colour they actually want — so a colour is always its swatches, and the last of them opens the browser's own picker. The presets are a shortcut, not the offer.

**Looking at another style does not throw away what you built.** The parts of one style mean nothing to another, so the face starts again when the style changes — but what was designed in each is held while the picker is open, so pressing the other style to see it and pressing back is reversible.

**Each row shows one part.** A row of eyes cannot answer "which eyes?" while the glasses somebody already chose are drawn over all eight of them — the whole row looks identical and the choice is unreadable. So a thumbnail for a part is drawn with everything _above_ it taken off, which the style itself says: `canvas.elements` lists its components in the order they are drawn. Nothing here is a list of things that get in the way, so a style that gains a part or reorders one is handled the day it ships. Everything below stays, so a part is still shown on a face rather than floating alone — and the face at the top of the picker keeps every choice, because that one is what they will actually wear.

Two rules about what is _not_ chosen:

- **A part nobody picked is left to the seed**, not set to a default. That keeps a half-finished face a face: somebody who changes the hair and stops has their own face with different hair, rather than a stranger with one familiar feature. Pressing a choice again un-picks it and hands that part back to the seed.
- **Surprise me is not the same as choosing nothing.** It picks every part, so what it makes can be kept, edited or put back. A randomiser that quietly cleared the choices would lose work.

The parts live on `profiles.avatar_options`, and changing style clears them — the parts of one style mean nothing to another.

### A face follows its person everywhere, or it is not their face

Three things make a drawn face: the **seed**, the **style**, and the **parts**. All three have to travel together, through every read and into every component, and the failure when one does not is the same each time — a reader designs a face, sees it on their settings page, and finds a different one looking back at them from the corner of every room. A save that looks like it half worked is worse than one that plainly did not.

Two rules hold it, and `build/avatar.test.mjs` reads the code for both:

- **Every read that hands out a style hands out the parts.** `space_people`, `space_member_card`, the team's roster, a provider's card, `my_profile`, `public_profile` — a read that gave the style and left the parts behind drew the right style with the wrong face.
- **Nothing draws the reader's own face out of their display name.** `SpaceAvatar` takes a `person`, and a caller who knows who somebody is must pass the record. A face made from "Member Person" changes the day they rename themselves, and was never the face they designed; a caller with only a label — a guest, the word "You" — passes a name on purpose and is drawn from it.

And one more, which is about the seed below: `my_profile` calls the resolved seed `seed`, because there `avatar_seed` means _what they actually picked_ and is usually empty. `seedOf` reads both. Reading only `avatar_seed` there falls through to the id and draws a face nobody else is looking at — which is how the header came to disagree with every room.

<Callout>
DiceBear names a shape option `<component>Variant` and a colour `<component>Color`, while the definition lists the components under their plain names. `optionsFor` in `lib/avatar.js` is the one place that knows the difference. Getting it wrong is silent: the options fail validation, the draw throws, the url comes back empty, and a picker full of broken images is the only symptom.
</Callout>

### The seed, and why it is not their address

A drawn face comes from a seed. The seed is **a digest of their address, made in the database** — never the address itself, which is disclosed to nobody. It is resolved once, in SQL, for every surface that draws a person (`space_people`, `space_member_card`, `my_profile`, `public_profile`), because a settings page that computed its own would show somebody a different face from the one everybody else is looking at.

The face the rest of the site is wearing is `myFace` in `lib/auth.js`, read through `my_profile` so it carries the resolved seed, and **written again when a profile is saved**. Filled only at sign-in, it left a reader's old face in the navigation until they reloaded.

The picker offers that seed and seven stable variations of it. Choosing the first one back means choosing nothing: `avatar_seed` goes null and the default is theirs again.

Never the display name. A rename must not make somebody a different person on every screen.

### Written through the row, read back through the function

A save writes the columns straight to the profile. What the page then holds is **not** that write
echoed back: it is `my_profile()` asked again. The two are not the same shape, and the difference is
the reason for the rule. A select can hand back `avatar_seed` — what somebody chose — but it cannot
hand back `seed`, the face they have when they have chosen nothing, because that is `coalesce` over a
digest the database makes. A page that took the select's row as the new truth lost `seed` the moment
anything at all was saved, and with it the designer's _Start again_.

The same shape of fault cost the designer itself: `my_profile()` returned the style and the seed but
not `avatar_options`, the parts. So a face somebody built was written to their row correctly and
never read back out of it — the picker opened with nothing chosen, every time, and because the page
reloads the profile when a save finishes, the save itself looked like it had done nothing. The
column was right, the write was right, the policy was right, and the feature did not work. **A
column a settings page shows belongs in every read that page makes**, and a column added to one
read and not the other is a feature that saves into a hole.

## What they are called

- **What to call you** (`display_name`) — what everybody sees. Absent, the part of their address before the `@`.
- **First and last name** — the real one, for a letter or an invoice. Never shown to another member unless they said so.
- **A line about you** (`about`) — 280 characters, shown on their card in a space and on their page.

## Their page, at `/p/<username>`

A **username** is an address: lower case, letters, numbers and hyphens, unique, and nobody has one unless they take one. The field says whether it is free as it is typed — `username_free` answers a boolean and never who holds it, because "taken by Ada" would make it a way to look people up.

**A profile is private until its owner turns it on.** `public_profile` defaults to false, and `public_profile(username)` answers nothing at all for a person who has not: a directory of everybody who ever signed up, indexed by search engines, is not a thing to publish on somebody's behalf. A name nobody holds and a name whose holder has kept their page private give the same answer — _Nobody here by that name_ — so the page never says whether an account exists.

What it answers is what they put there and nothing else: the name they chose, the line they wrote, the face they picked. Not their address, not what they bought, not what they have read, not which spaces they are in. Each of those is a different question with a different answer, asked of a read that knows who is asking.

One thing IS added to it: **what they offer**. Where a site has turned provider offerings on, a provider's page lists their live ones — what each is, how long, what it costs, and the way to book it. That is not a contradiction of the rule above but the point of it: an offering is published by its author and then by a person who released it, and an hour with somebody that will not say who is not something anybody can buy. Nothing else about them comes with it. See [Providers and payouts](/content/docs/reference/suppliers).

Where the site runs its **social network** (the `network` module), an open page also carries the network's side of them: how many follow them and whom they follow, a **Follow** button, a menu to mute, block or report them, and the posts the reader may read — each post's own audience still deciding, so a post to the site's people is not shown to a guest on an open page. A closed page stays a name nobody holds; somebody with one still posts, follows and is followed. See [The social network](/content/docs/building-a-site/social-network).

The person's own settings are at **`/account`**, not under `/p` — `/p` is the prefix for pages somebody PUBLISHES, which is the whole reason it is one letter, and `/p` with nothing after it read as a profile with no name. It is in the account menu as **Your account**. When a protected action opens sign-in, the modal carries its return address through password, magic-link or Google authentication; only a same-origin address is followed, so an external target falls back to the site.

The account button in the header **is** that face, not a letter. It rides along with the role —
already read once per session from the same row — so the chrome costs nothing extra to show
somebody themselves. The initial of their address is what shows for the moment before the profile
has answered, and never instead of a face they made: a person who designs one and then sees a
letter on every page has no reason to believe it saved.

Their own settings also show **Your teams**, where the site puts them in any (see
[Teams](/content/docs/running-a-site/bookings/teams)): each team, the line its file carries, and which of the
three ways they came to be in it. Read only — leaving is not offered, because a rule that swept them
in would sweep them back on the next sweep.

## A coach builds their own page

A profile page says who somebody is. A **coach** usually needs to say more than that — what a session is, who it is for, what it costs — so they build a page, with the same builder the site's landing pages are built with, and it stands at their own address.

It is an ordinary landing page (`content/pages/<name>.md`) with two lines that make it theirs:

```yaml
route: /p/coach-person
owner: coach-person
```

A page claiming that exact route **wins** over the profile page, which is what stands there for somebody who has not built one. Every section in the catalogue is available to it, and the page is a page in every other respect: the same compile, the same prerender, the same share image.

### They edit one thing, and the server is what decides that

A coach is **not** an editor and must not become one by being let through the admin's door. So the `admin` function gives them a **fence** — one collection, and the records whose `owner` is their username — and the pipe honours it on every verb: the collections listing shows Pages alone, the list is filtered, and every read, save, create, rename, delete and publish of a record that is not theirs is **refused**, not merely hidden. A surface that only hid other people's rows would leave every one of them a hand-written request away. `build/admin-fence.test.mjs` asks each verb twice — once for a record that is theirs and once for one that is not.

`owner` is read-only in the form, because a coach who could edit it could sign themselves somebody else's page. A coach who has not taken a username has no page to own and is refused like anybody else.

### One test, two ways

A coach may run a single A/B test on their page: two page files on the same route, and an [experiment](/content/docs/running-a-site/marketing/ads-and-experiments) between them. **Two variants, not three** — a page one person is answering for does not have the traffic to settle a three-way test, and the experiment's own validation refuses it.
