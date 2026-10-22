---
title: Achievements and traits
description: Two things out of one stream — what somebody has done that is worth saying out loud, and what the site has come to believe about them.
order: 31
sources:
  [
    packages/kit/supabase/schemas/98-achievements.sql,
    packages/kit/build/achievements-push.mjs,
    packages/kit/build/steps/achievements.mjs,
    packages/kit/src/lib/awards.js,
    packages/kit/theme/src/pages/AwardPage.vue,
    packages/kit/theme/src/components/AwardBadge.vue,
    packages/kit/theme/src/content/ui/awards.md,
    packages/kit/build/awards-db.test.mjs,
  ]
reviewed: 2026-10-20
---

The site already records what people do. Every user-facing act is an event — a piece read, a book chosen, a button pressed — and has been since the first analytics. So neither of these invents a second way of noticing; they both read that stream and nothing else.

## An achievement is a rule and a page

`content/achievements/<slug>.md`. The frontmatter says what earns it; the body is its page.

```yaml
title: The whole shelf
sub: Every book in the library.
icon: star
colour: '#6a4b8a'
when:
  event: content_read # an analytics event type
  where: { kind: book } # the props that must agree (a subset; may be omitted)
  count: 11 # how many it takes (default 1)
  distinct: id # count DIFFERENT values of this prop, not rows
```

`distinct` is the difference between _eleven books_ and _one book eleven times_, and it is the field most rules want. Without it a `count` counts events.

**Nothing is awarded by a client.** One trigger on the event stream decides, running as the definer — a browser can no more ask for a badge than it can ask for a role. `build/awards-db.test.mjs` asks each way: the rule met and not met, the same thing twice, the third different one, awarding twice, and a client trying to insert its own.

**The rule is a declaration; what somebody has earned is an act.** The files are projected into `public.achievements` by `build/achievements-push.mjs` on a machine, and by the `achievements` model's `projected()` on a **publish** where there is no machine to run a script on — the same writes either way, so a rule reaches the database on every deployment shape rather than only the ones that rebuild. Who holds what is a row nobody edits. Delete the database and redeploy and every rule comes back and nobody's badges do — which is the honest answer, because a badge is a fact about a person and the facts about people live where the people do. In local development, matching Markdown edits refresh the compile and explicitly safe local projection; remote or deployment-only work is not run by the watcher, and projection failures stop the refresh.

### Its page, and the gallery

Every achievement has a page at `/a/<slug>`: the badge, the title, whether the person has it and when, the markdown body, and any audio or video the file names (through `MediaBlock`, like everything else that plays here). `canAccess` gates the body on the usual ladder; the title is never gated.

**A page anybody may read, earned or not.** One nobody can open before they have earned it is one nobody knows to try for.

On a profile its owner has made public, the badges appear as a gallery — earned ones filled in their own colour, the rest drawn quietly beside them, because a gallery that shows only what somebody has never says what else there is. `shown: false` keeps one off every profile: some are the site's own note.

## A trait is what the site has come to believe

`content/traits.md`, one file, because a trait is one line and fifty of them in fifty files is a directory nobody reads.

```yaml
visible: [admin, coach]
rules:
  - id: interest-from-reading
    event: content_read
    key: interest
    value: prop:kind # taken from the event, so a new topic needs no new rule
```

A trait is a **key and a value** — `interest` and `manifestation` — not one string somebody will end up parsing. `value: prop:<name>` takes it from the event itself, which is how one rule covers every topic a library has. The row counts how many times it has been seen, which is the difference between a glance and an interest.

Three rules about them, and they are in the code and not only here:

- **Never shown to another member.** Not on a profile, not in a room, not in a directory. The tables reach no client at all; the staff read them through `traits_of`, which checks the role.
- **Never shown to the person it is about either.** A page telling somebody what an algorithm thinks of them is a page nobody asked for, and it invites gaming besides.
- **A note, not a judgement.** A trait says what happened. What to conclude from it is a person's job.

**Who may look is part of the declaration**, not a role name buried in SQL: `visible` is projected into `app_settings`, and `may_see_traits()` reads it. An administrator always may.

They are shown in the admin on **People → People**, opened one person at a time — it is a note for whoever is about to talk to them, not a column to sort by.
