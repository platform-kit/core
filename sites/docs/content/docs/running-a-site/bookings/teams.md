---
title: Teams
description: A group of people the site can point work at — declared as a file, with who is in it kept as rows.
order: 27
sources:
  [
    packages/kit/build/teams-io.mjs,
    packages/kit/build/models/core/teams.mjs,
    packages/kit/build/teams.mjs,
    packages/kit/build/teams-push.mjs,
    packages/kit/build/steps/teams.mjs,
    packages/kit/supabase/schemas/56-teams.sql,
    packages/kit/build/teams.test.mjs,
    packages/kit/build/teams-db.test.mjs,
    packages/kit/src/lib/teams.js,
    packages/kit/theme/src/components/admin/TeamMembers.vue,
    packages/kit/theme/src/content/ui/teams.md,
    packages/kit/theme/src/pages/PersonPage.vue,
  ]
reviewed: 2026-10-26
---

A **team** is a group of people the site can point work at: the practice, the front desk, the coaches
who take discovery calls. It exists so a booking type can be _the team's_ rather than one person's,
and so who is in it can change without anything that points at it being edited. Module: `sessions`.

## A team is a file; who is in it is not

```yaml
---
name: The practice
position: 1
fill:
  role: provider
---
Everybody who gives sessions here.
```

`content/teams/<slug>.md` — the name, where it sits in a list, a picture beside it, and optionally a
**fill**: who it is for, in the same grammar a space's membership uses (`role` · `tier` ·
`entitlement` · `bought` · `booking`, with the same windows). The body is the line a surface shows
beside the name. If the repository were deleted and redeployed, every team would come back exactly
as it was.

**The file never names a member**, and there is no key for it. A declaration names classes of people
and never a person, so who is _in_ a team is rows — `team_members`, each saying how that person came
to be there:

| `source` |                             |
| -------- | --------------------------- |
| `fill`   | the rule swept them in      |
| `invite` | an administrator asked them |
| `manual` | put there by hand           |

The sweep adds everybody the rule matches and removes **only what it put there**, so somebody
invited stays through any change to the rule. That is the whole reason the column exists. It is the
same sweep the spaces use, one table over.

## Editing a team

Sales → **Teams**, one record per team: the name, the line under it, a picture, where it sits, and
**who is in it** — a list of ways somebody joins on their own, ticked rather than typed (everyone
who gives appointments, every coach, everyone on the staff, everyone on a membership tier the site
sells). The fill rule is never shown as its own shape: the editor carries a team's choice both ways,
and a rule written by hand that has no word for it keeps itself exactly as it was read. Ticking none
means the team is invitation only.

Saving compiles the declaration and projects it; the projection deletes only the rows the file owns,
so nobody invited is ever swept away by a save.

To keep somebody out of a filled team, change the rule — removing them by hand works until the next
sweep, and saying so is more honest than pretending otherwise.

### The people in it

Under those fields, in the same drawer, is **who is actually in it** — each person with **how they
came to be there** (the rule swept them in, they were invited, they were added by hand) and when,
with **Remove** beside each and **Add somebody**, which searches every account by name or address.

It is a separate panel and not a field, because it writes something else: the fields above are the
file, and a member is a row. A team being saved for the first time has no rows yet, and the panel
says so rather than offering a control that would write against a slug that does not exist.

**In cloud mode this is the ordinary state for a while.** A save is a draft, a publish is a commit,
and the projection is the deploy's — so between publishing a new team and the next deploy it exists
as a file and as nothing else. The panel asks whether the row is there and says _This team is saved
but is not in the database yet_ rather than _Nobody is in this team_, which would be false, and it
withholds **Add somebody**, which the foreign key would refuse when pressed. An administrator reads
every team, published or not, which is what makes the question answerable.

Removing somebody the rule matches is honest and temporary: the next sweep puts them back. The way
to keep them out is the rule.

## What somebody sees of their own teams

On their account (`/p`), under their page settings: **Your teams** — each team they are in, the line
the team's file carries, and which of the three ways they came to be in it, with the date.

It is read only. Leaving is not offered, because a rule that swept somebody in would sweep them back
on the next pass, and a control that silently undoes itself is worse than none. Somebody who should
not be in a team is taken out by whoever runs the site, and by changing the rule where a rule put
them there.

## What the compile refuses

A team with no name, a slug the database would not take, two teams with one slug, a fill whose key
is not one of the five, a fill naming a tier no membership declares or a sku the site does not sell
— and **a booking type pointing at a team that is gone or unpublished**, which would otherwise show
somebody an empty calendar and say nothing.

The fill is compiled by the same function a space's is, so a tier that fills a room and a tier that
fills a team are checked by one piece of code and refused in one voice.

## Who can see what

A team's **name** is public, because a booking type carries it and a booking names its hosts. What
it is for, and who is in it, are not: a membership list is a directory, and a directory of everybody
who works here is not a thing to publish on their behalf.

`team_people(team)` answers a member of that team or an administrator, with the names and faces a
booking already shows and never an address — the whole face, the parts somebody designed included,
since a read that gives the style and not the parts draws a different person. `my_teams()` answers a person their own teams and how
they came to be in each.

## In the build

`build/teams.mjs` compiles the files (after the catalog, because a fill may name a tier the site
sells) into `.velite/teams.json` and `supabase/functions/_shared/teams.json`.
`build/teams-push.mjs` writes them into the `teams` table and runs the sweep — a projection, going
one way, never reading a row back into a file. A team whose file has gone is **deleted**, and its
memberships with it: unlike a space, a team holds nothing anybody said. Locally, changing a team file refreshes this projection only when a local database is detected; a failed team listing is an error, never an empty declaration that could sweep memberships away.
