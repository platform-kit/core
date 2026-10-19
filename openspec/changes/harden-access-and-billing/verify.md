# Verification

Applied on 2026-10-19 at James's request. Not archived: read it, then `/opsx:archive`.

Every test below was also run against the code as it was before this change, by serving the old function or re-opening the old grant on the local database for one run. Each one failed there on the findings it covers, and then passed on the fixed code. A test that has never been seen failing proves nothing.

## Scenarios

| Scenario | Result | Evidence |
| --- | --- | --- |
| a tampered checkout | **passed** | `node build/checkout-tamper.test.mjs`, 14 checks. Each session was read back from Stripe's test mode and expired afterwards. A request carrying a price, amount, currency, discount, promotion, class and shipping cost is charged the offer's own $28 in USD, with no discount and the destination's rates. A quantity of 999 becomes 10. An invented shape, an unsold shape, a shape on a thing that has none, and two shapes of one thing are refused. A part-chosen shape is priced as the whole one. A reader who claims to be a member pays $18; a real member pays the members' $15. Against the old checkout, 5 checks failed, including `leather` charged $18 instead of $28. |
| another account's id | **passed** | `node build/ownership.test.mjs`, 75 checks. It covers 13 tables (orders, purchases, bookings, subscriptions, entitlements, payout accounts and lines, usage, form answers, agent runs and steps, support tickets and contacts), each asked by id by `member2@` and by a visitor, plus `order_lines`, `order_total`, `agent_run_state`, `support_ticket_mine`, `payout_balance`, `session-files`, `payouts` and `book-files`. Every one came back as nothing, while the owner reads their own. The database's own list of definer functions a visitor can call is checked as well. With `order_lines` re-granted to visitors, the test failed. |
| staff within their role | **passed** | `ownership.test.mjs`: a provider, an analyst and an editor read no customer's form answers or agent steps, while the support desk does read the steps. A provider cancels and marks as a no-show no booking that isn't theirs, and the booking is unchanged. With the old form-answers policy restored, the test failed for all three. |
| self-promotion | **passed** | `node build/roles.test.mjs`, 53 checks. A reader, an editor and a provider each try to write their own `roles`, `role`, `stripe_customer_id` and `email`, call `set_roles` for themselves, and insert themselves into entitlements, purchases, subscriptions, space members, space roles and team members. They also try to revive their own entitlements, move a channel membership to another room, mark a rule's membership as their own, create an offering already on sale or already released, and write or approve their own comment. Every attempt is refused and their profile is unchanged. With the old channel, comment and offering grants restored, 6 checks failed. |
| the last administrator | **passed, with one part not shown failing** | `roles.test.mjs`: the only administrator cannot remove their own role. Over five rounds, two administrators removing each other at the same moment always left one. The test was not run against `set_roles` without its new lock, so the race check has not been seen failing. |
| forged, altered and replayed events | **passed** | `node build/webhook-doors.test.mjs`, 31 checks, using the stack's real `CAL_WEBHOOK_SECRET`. cal.com refuses unsigned, wrongly signed and one-byte-altered bodies, and an event signed two days ago; neither writes a row. A replayed "created" leaves a cancelled booking cancelled. LiveKit refuses an event signed with the development secret when the site has no LiveKit account. social-webhook refuses an unsigned body. print-webhook ignores a mocked printer. Stripe has no webhook secret on this stack, so it refuses every body (the existing checks); its signature and age limit are the SDK's. Hyperswitch's three-day age limit is pinned by `node build/hyperswitch-payment-provider.test.mjs`. Against the old functions, 5 checks failed: a stale event was applied, the replay revived the booking, LiveKit accepted the development secret, and the print webhook read a mock job. |
| link lifetimes | **passed** | `ownership.test.mjs`: the attendee's recording link carries a token that expires within 3600 seconds, and a booking whose row names another booking's film is given no link. Purchased files (`book-files`), support attachments and form files were already signed for an hour. Printers' links stay at seven days: they go only to the printer, which fetches them when the job is made and may retry, and they are never stored or shown to a customer. |
| a flood from one visitor | **passed** | `node build/abuse-limits.test.mjs`, 13 checks. Guest checkout, form answers and analytics intake refuse a visitor past their hourly limit and still serve another. A signed-in reader is counted by their account from any address. A caller's own `x-forwarded-for` is never the address counted, and no address is ever written into the counter: it counts under a hash, so the analytics promise of keeping no IP address holds. A gzip body that opens past a megabyte is refused unopened. The support widget refuses a sixth new guest from one address and serves another. Sign-up is limited by the auth server's `sign_in_sign_ups`. Against the old doors, 6 checks failed, including the bomb opened to 8 MB. |
| a built site with known secrets | **passed** | `node build/bundle-secrets.test.mjs`: 45 secrets were planted in a copy of the demo, and none of them appears in any published file. Planting a key the bundle does carry made it fail. |

`openspec validate harden-access-and-billing --strict` passes. `node build/docs-check.mjs` passes on all 88 pages. `node build/declarations.test.mjs` passes 987 of 987; it was 10 failing before. `node build/destructive.test.mjs` passes 63 of 63.

## Every finding

Every finding in `review.md` is marked there as fixed, proposed separately, or no change, with the reason. Proposed separately:

- **O11**, the avatar seed derived from the email address. Changing it changes every default face.
- **O13 and D3**, a guest's form answers being keyed by the analytics id. The rate limit is fixed here; `once` for guests needs a product decision.
- **P8**, paid events having no payment-to-place link.
- **W9**, the form webhook's default secret. Changing it breaks receivers that verify today.
- **D5**, a sign-up captcha. It is already queued on the Spaces roadmap.
- **D6**, recordings planted in the audio bucket.
- **F9**, the dev runner's stale schema copy.
- **F11**, hosts named by an address with no account yet.

## Behaviour that changed for people

- **A guest's purchases, orders and bookings join an account only once it proves the address**: a sign-in by the emailed link, or a provider. An invitee booked by address sees the booking once proven too. Until F5 was fixed, the link never marked anyone proven. So on a live site, an account that signed up by password and has not yet used a link will find its guest purchases the next time it does. Before, a password sign-up claimed non-session purchases at once, which let anybody claim them by typing the address.
- **One order holds one shape of each product.** Two sizes of one shirt are two checkouts. Before, the second was charged and shipped as the first.
- **A provider no longer acts as an administrator** over other hosts' bookings. They can't cancel them, move them, mark no-shows, list them all through the Scheduling API, or book for people on types they don't give.
- **Stripe's own promotion codes are offered only when the site discounted nothing.**

## Regressions checked

49 existing tests touching what changed were re-run against the local stack. Three of them asserted the old rules and were updated to the new ones: `guest-session-booking`'s text check of the claim, `scheduling`'s invitee check (now: not seen before the address is proven, seen after), and `support-api`'s client calls, which now come from one visitor of their own. Every other failure is either already present before this change or comes from this machine's setup:

- `agents`: a text check on `agent-run`, which this change didn't touch.
- `cron-registration`: its fixed job list predates the Hyperswitch, network and social jobs.
- `orders-db`: it expects a seed row only the old database had.
- `providers-db` and `scheduling`: their letter checks read Mailpit at port 54324, and `sites/demo/.env` sets `SMTP_HOST=192.168.97.7`, an old container address. With the mail checks off, `scheduling` passes 30 of 30.
- `support-api`: the Chatwoot snippet in the browser times out, and it fails the same way with the old support module.

## Notes

- **Local database:** the demo's dev database was months behind its schema (F9) and was reset to the declaration, with the seed steps re-run. The dev servers were restarted afterwards.
- **Hosted address header:** the limits trust `cf-connecting-ip`, which Cloudflare sets in front of a hosted Supabase project. On a host without Cloudflare, they fall back to `x-real-ip` and then the last `x-forwarded-for` entry. Watch the counts on the first deploy.
- **Downstream site:** a downstream site's own `.env` ships a `VITE_` password hash that doesn't match its comment. That's the site's to fix, not PlatformKit's.
