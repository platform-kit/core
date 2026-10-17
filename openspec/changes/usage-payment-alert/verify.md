# Verification

Applied on 2026-10-17 at James's request. Not archived: read it, then `/opsx:archive`.

## Scenarios

| Scenario | Result | Evidence |
| --- | --- | --- |
| a payment needs verification | **passed** | `node build/usage-alert.test.mjs` (24 checks); in a real browser on the demo with a seeded `requires_action` settlement, the red banner showed on the home page, an articles page and Billing at 1280×900 and 390×844 in light and dark, with the verification line and a link to `/billing#usage`, and no horizontal overflow |
| a payment failed | **passed** | `usage-alert.test.mjs`; the usage function answered `failed` for the seeded settlement, and the banner showed the failed-payment line |
| a processing payment, or none | **passed** | `usage-alert.test.mjs` (pending, none, no answer); a signed-out visitor saw no banner; another member (`member2`) got `null` |
| dismissal lasts one page view | **passed** | dismissed on the home page, it was gone; after a header link (no reload) it was back; dismissed again, it was back on the next full page load |
| pages the banner stays off | **passed** | `usage-alert.test.mjs` (checkout, embeds, preview, share); no banner on `/checkout/hyperswitch` in the browser |
| the server answers for the signed-in customer only | **passed** | `usage-topup` `{ action: 'attention' }` on the local demo stack: 200 `requires_action` (then `failed`) for the seeded member, `null` for another member, 401 without sign-in |

## Notes

- The demo sells no metered plan, so the browser check used a temporary metered offer and a seeded subscription and settlement, all removed afterwards.
- With the banner, a landing page's header and hero move down together by the banner's height: measured on mobile, the header and the hero heading keep the same distance as without it, as with the page builder's own Announcement.
- The usage function could not be type-checked with `deno check` on this machine: Deno resolves JSR packages through an unreachable staging registry. It ran on the local Edge Runtime instead.
- Unrelated, seen while verifying: a metered offer without `usage.unit` is refused by the content build ("Required usage.unit"), while the usage-billing docs call it optional with a `credits` default.
