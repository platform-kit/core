# Tasks

## 1. Groundwork

- [x] 1.1 `admissions` with its grants and row-level security, and the one function that moves its status (47-admissions.sql); `declarations.test.mts` 1383/0, `schema.test.mts` 46/0
- [x] 1.2 Catalogue: the `before` block on any offer and the build refusals in the design — `admissions.test.mts` 14/0
- [x] 1.3 Glue between forms and admissions (the `form` function), and between sessions and admissions (`booking.ts`, `cal-webhook`, `glue/core+sessions.sql`); the assembled snapshot re-recorded, `assembled-identical` 4/0

## 2. The ways in

- [x] 2.1 Applying: the `form` function creates the admission, with `review: none` opening it at once — driven in a browser on DharmaLab: the application recorded `applied` with its answers
- [x] 2.2 Reviewing: approve, decline, close and reopen, with the note (the `admissions` function) — approved from Sales → Applications in a browser; the note kept and sent
- [x] 2.3 The call: booking records it on the admission, a held call opens it (the hourly sweep), "Not a fit" closes it; an optional call is offered on the application's last screen, after the answers are sent — the last screen and its "No thanks" driven in a browser
- [x] 2.4 Checkout refuses a gated offer without an open admission; a purchase, subscription or plan uses it up (trigger) — a direct request refused with 403 before approval and let past the gate after, in a browser
- [x] 2.5 The hourly sweep expires admissions of offers that set `open-for`; a reviewer can close an open one
- [x] 2.6 `admission` in the audience grammar, the database and the audience editor — `admissions.test.mts`
- [ ] 2.7 `admissions-db.test.mts` and the checkout-tamper scenario as stack tests (the paths, the used-up trigger, the sweep, the funnel audience)

## 3. Screens, emails and docs

- [x] 3.1 The Pricing section and the offer's checkout page: Apply / Application sent / Declined / Closed / the ways to pay once open, and the optional call link — each state driven in a browser
- [x] 3.2 Sales → Applications (answers under each question, in the form's order), and "Not a fit" on the host's booking — checked at 1280 light and 390 dark
- [ ] 3.2b The person's view in the admin shows their admissions
- [x] 3.3 The four emails, with editable strings and kit default designs — compiled clean; sent to the right people (DharmaLab's dev relay refuses its unverified domain)
- [x] 3.4 The selling documentation (`applications-and-intro-calls`) and the frontmatter reference — `docs-check` 91 pages agree
- [ ] 3.5 Each scenario verified as named (the stack tests in 2.7 remain)
