# Tasks

## 1. The data

- [ ] 1.1 The module manifest (all three shapes) and the schema: courses as content, `enrollments`, `lesson_progress`, `certificates`, with policies so each person reads only their own. Verified by `courses-db.test.mjs` and `ownership.test.mjs`.
- [ ] 1.2 Enrollment on purchase, tier and free start; closing and reopening on losing and regaining access. Verified by `courses-db.test.mjs`: the refund-and-return scenario.
- [ ] 1.3 The open-lessons rule (all at once, drip, cohort dates, in order) and the content endpoint asking it. Verified by `courses-db.test.mjs`: a closed lesson sends nothing.
- [ ] 1.4 Completion from marking, quizzes, chapters and forms; course completion awarding the achievement and issuing the certificate. Verified by `courses-db.test.mjs`.

## 2. The screens

- [ ] 2.1 The course page, lesson page, app-area list and certificate page, with strings. Verified by `courses.test.mjs` in a browser at 390 and 1280 px, light and dark.
- [ ] 2.2 The admin course builder and enrollments view. Verified by `courses.test.mjs` driving the admin.

## 3. Around it

- [ ] 3.1 Release and completion emails through the email module, once per lesson. Verified by `courses-db.test.mjs`.
- [ ] 3.2 Spaces rule "enrolled in course (cohort)", lesson comments, the member-card panel, analytics events. Verified by `courses-db.test.mjs` and `member-panels.test.mjs`.
- [ ] 3.3 A sample course in the demo. Verified by the e2e run.

## 4. Docs and verification

- [ ] 4.1 A "Courses" docs page, FEATURES.md, and the Kajabi comparison row. Verified by `node packages/kit/build/docs-check.mjs`.
- [ ] 4.2 Report each scenario as passed, failed or not verified, with why. Verified by `verify.md`.
