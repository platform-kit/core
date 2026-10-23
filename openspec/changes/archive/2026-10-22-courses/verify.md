# Verification

Run on 2026-10-22: the demo and the club end to end (`platformkit test --e2e --only demo,club`), with the demo's courses as a place of its community.

| Scenario | Result | Evidence |
| --- | --- | --- |
| A lesson that points at a chapter | Passed | `courses.test.mjs`: a chapter lesson names its book by slug and chapter number (`plain-words#1`) and opens the book there (`?chapter=1`); nothing it names is an id that a rename changes. |
| A refund and a return | Passed | `courses-db.test.mjs` in the end-to-end run: bought, enrolled on the way in, two lessons done; refunded, the third closed with `no-access` and no text; bought again, the same enrollment with two lessons done and the third open. |
| A lesson not yet released | Passed | `courses-db.test.mjs`: the answer says `not-yet` with the date, and no `body` is in it; finishing it early is refused. |
| The last lesson | Passed | `courses-db.test.mjs`: the enrollment completes, a `course_completed` event is recorded, the demo's achievement on that event is awarded, and the certificate answers at its public address to a guest. The certificate page was rendered, and its PDF checked in `courses.test.mjs` (objects where the table says, accents written, brackets escaped). |
| A new lesson opens | Passed | `courses-db.test.mjs`: one email is owed for a lesson that opened after somebody started, the next waits a day, and no lesson is owed twice; `course-notify` answers only the service. |
| A course in the community | Passed | `courses.test.mjs` (the place, its claim, the forward, the refusal of a site's own `courses` place) and the demo rendered: `/courses/writing-plainly` opened in the community with Courses selected, at 1280 and 390 px. |
| A community with no network | Passed | `courses.test.mjs`: refused, naming the spaces and network modules. |

The screens were rendered and looked at for every state at 1280 and 390 px, in light and dark: the list, a guest, a reader not started, partway, finished, an open lesson with video, a chapter lesson, downloads, a closed lesson, the certificate, the reader's Courses tab, the admin's builder and Enrollments, and the community place. A save from the builder left the same course in the file.

End-to-end: the demo passed 78 of 79 checks and the club 29 of 31. The failures not about courses: `payouts-db` on both (Stripe Connect is not enabled in the test account). The club's `ownership` refused `certificate_public` as an unreviewed public read; it is public on purpose (an unguessable address, and what a certificate prints) and is now on the reviewed list, and `ownership` passes 75 of 75. The coverage gate: every one of the 58 functions served was called.

Not verified: the course builder and the projection in cloud mode (content in rows) beyond `courses-db`'s use of the same projection the model calls.
