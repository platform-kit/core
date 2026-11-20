# Tasks

## 1. Groundwork

- [ ] 1.1 `admissions` with its grants and row-level security, and the one function that moves its status; `declarations.test.mts` passes
- [ ] 1.2 Catalogue: the `before` block on any offer and the build refusals in the design
- [ ] 1.3 Glue between forms and admissions, and between sessions and admissions, declared only while both modules are on; `modules-off.test.mts` passes

## 2. The ways in

- [ ] 2.1 Applying: the `form` function creates the admission, with `review: none` opening it at once
- [ ] 2.2 Reviewing: approve, decline and reopen, with the note
- [ ] 2.3 The call: booking records it on the admission, a held call opens it, "Not a fit" closes it
- [ ] 2.4 Checkout refuses a gated offer without an open admission; the success webhook uses it up
- [ ] 2.5 The hourly sweep expires admissions and sends the reminder a day before

## 3. Screens, emails and docs

- [ ] 3.1 The Pricing section and the store's offer page: the call link, and Buy / Apply / Book a call / Application sent / Checkout open / Declined
- [ ] 3.2 Sales → Applications, the person's view, and "Not a fit" on the host's booking
- [ ] 3.3 The emails, with editable strings
- [ ] 3.4 The selling documentation and the strings reference
- [ ] 3.5 Each scenario verified as named
