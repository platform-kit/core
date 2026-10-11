---
title: Your account, membership and purchases
description: What an account keeps, what a membership opens, buying a book, and where to find your files and orders.
order: 31
sources: [packages/movable-types/src/components/AuthModal.vue, packages/movable-types/src/components/store/ProductPage.vue, packages/kit/src/lib/downloads.js, packages/kit/src/lib/booking.js]
reviewed: 2026-10-05
---

## An account

An account keeps a person's place in every book, their highlights, their quiz results and trophies, their readings on a site that has them, and their purchases. Sign in with an email and a password (or Google, or a magic link, where the site offers them). When a feature asks for sign-in to finish an action, it returns to that same-site page afterward; the modal's return address is never allowed to point to another site. A new reader has an account the moment they sign up; a confirmation link goes to the address, and a few things — the results of a reading, being reachable from the support desk — wait until it is clicked.

Nobody is handed a face. An account starts with a **pattern** drawn from a digest of its own
address — not a face, because a face nobody chose can be wrong about the person wearing it. **Your
account** in the account menu is where that is changed: a style, then the parts of it, or a picture
of your own, which always wins. What is designed there is what the account button in the header
shows from then on, on every page. See
[A person's own page](/content/docs/running-a-site/community/people-and-profiles).

## A membership

A membership opens what the site's rules give members: every chapter of every book, the members' articles, the coaching chat, the sessions the tier includes. Join from the pricing page or the store; **Manage membership** in the account menu opens the billing portal to change the card or cancel. Switching to a higher plan happens now, charged for the difference; switching down takes effect when the current period ends.

## Buying a book

A book's store page offers every way to have it: **read online** (the unlock, which opens the whole book on the site), a **printed copy** (softcover, hardcover, sometimes a premium binding; the contents, and for a hardcover the cloth and foil, chosen on the page), and **files** (PDF, EPUB). Choose the country the copy ships to first; the shipping methods and prices follow it.

The gallery prefers generated page images. If one is missing, it shows a bounded text preview with a label for its content type; on phones, swipe horizontally or use the position buttons to move between slides.

A printed copy or a file can be bought **without an account** — checkout asks the email. If an account is made later with that address, the purchase is there.

## Your files and orders

A buyer of a file, or of a printed copy that includes the files, finds them under **Your files** on the book's store page and on its cover page in the person — every edition of the file, as links that are minted fresh each time. An order's confirmation comes by email, and a second email with tracking when the parcel ships. The printer ships straight to the buyer.

## Coaching

The Coaching tab of the app shows the sessions somebody may book — how many this week or month, and when a used-up allowance comes back — and books them there: a month of open days, the day's times, a confirm step. Signed-out visitors can also browse public sessions and availability at `/community/coaching` (the `/app/coaching` entry redirects there), without seeing personal bookings or chat. Sign-in is requested before paid checkout, and the selected time is checked again after authentication. Upcoming sessions can be moved or cancelled from the row. The **Chat** tab is the conversation with the coaches, for members and for a week after a paid session.

## Getting help

The chat launcher in the corner of every page reaches the support desk. A guest can write without signing in; signing in makes the reply reachable by email.
