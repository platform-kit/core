# Design

## Context

See proposal.md for why. Today:

- **The card.** The theme's `SpaceMember.vue` draws the private half from `panels` imported from `#site/member`, which core defaults to `[]` (`build/site.mjs`, `MEMBER`). It shows them only when the card's own answer says the reader may see more (`card.more`).
- **The rule.** `public.may_see_member(p_user)` in the kit's `90-spaces.sql`: that person, or staff.
- **DharmaLab's panels.** In its own repository: `src/community/member.js` registers three components, and `db/schemas/10-member.sql` adds `member_read`, `member_working` and `member_bought`. Each is a security-definer SQL function that answers through `may_see_member` first. Their words are DharmaLab's `content/app/ui/spaces.md`, under `member-panels`.
- **The data.** All of it is already the kit's: `events` (`30-analytics.sql`), `purchases` (`40-commerce.sql`) and `signals` (`20-instrument.sql`). The level names come from the site's instrument (`#site/instrument`, `LEVELS`; core's default is `{}`).
- **The admin.** `admin_person` (`10-foundation.sql`) lists a person's purchases with its own query: every status, newest first, for administrators only.

## Goals / Non-Goals

**Goals:** the kit's three panels, gated by module, worded by the site, behind the existing rule; one source for a person's purchases; DharmaLab moving onto them with no visible difference.

**Non-Goals:**
- A setting in the admin to arrange panels. The order is declared in the site config, like every other registration.
- Panels for modules beyond these three (coaching sessions, community activity). Each can follow the same pattern when somebody asks.
- Any change to who may see the private half.

## Decisions

1. **The data reads move into the kit's schema unchanged in shape.** `member_read`, `member_working` and `member_bought` move from DharmaLab's schema to the kit's, beside `may_see_member`, with the same arguments and answers. DharmaLab's copies are byte-for-byte the starting point, so its cards cannot change. Alternative: new names under a kit prefix. Rejected because DharmaLab's schema would then have to drop its functions in the same deploy as the kit adds its own; with the same names, the kit's simply replaces the site's.
2. **One purchase source.** A kit function, `person_purchases(p_user, p_lim, p_paid_only)`, holds the one query: same fields, same order (newest first). `member_bought` returns it through `may_see_member`; `admin_person` embeds it with no limit and every status, as today. The admin keeps the statuses it shows today; the card keeps showing paid only. The rows and their order are shared, so the two cannot disagree. Alternative: the card calls `admin_person`. Rejected because that answer is administrators-only and carries far more than a member should be sent.
3. **The panels live in the theme; the gates live in core.** The three components move to `packages/movable-types/src/components/spaces/panels/`. Core's `#site/member` becomes the kit's list filtered by modules: Working only when the instrument module is on and `LEVELS` names at least one level. The site's config then applies `member: { off: [...], panels: [...], order: [...] }` on top. Alternative: the theme decides the gates. Rejected because module switches are core's to read, as everywhere else.
4. **Words.** The theme's `content/ui/spaces.md` gains `member-panels` with the defaults quoted in the proposal. A site's existing `member-panels` strings override them key by key, so DharmaLab's file needs no change.
5. **Testing.** `member-panels.test.mjs` is a unit test over core's list: the gates per module, `off`, `order`, the site's own panels, and level names from `LEVELS`. `member-panels-db.test.mjs` runs against the stack: own card, staff, another member refused as empty, the store off, and the card and the admin agreeing.

## Risks / Trade-offs

- [A site defines its own `member_read` with different semantics] → Whichever schema file loads last wins, silently. The assembler is to refuse a site schema that redefines a kit function by name (tasks); DharmaLab's copies are identical and are deleted in its own change.
- [Read shows titles as they were when read] → This is intended and kept from DharmaLab's version. A renamed book still reads as what the person opened.
- [The Working panel depends on a site's instrument vocabulary shape] → It reads only `LEVELS[key].name`, which `#site/instrument` already exports for the admin. A site without it shows no Working panel.

## Migration Plan

1. The kit ships the functions, components, strings and gates; the demo shows Read and Bought.
2. DharmaLab, in its own repository, deletes `src/community/Member*.vue`, `src/community/member.js` and `db/schemas/10-member.sql`, and drops `member` from its config. Its strings stay.
3. Rollback: DharmaLab's previous commit restores its own panels; the kit's are turned off with `member.off`.
