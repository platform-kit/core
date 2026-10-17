# Design

## Context

Incremental usage settlements live in `usage_incremental_settlements`, readable by the service role only. The Usage view learns of the ones needing attention from the `usage-topup` function's `read` action, which also loads the auto top-up settings, the customer's saved payment method and their subscriptions. Its recovery section shows each settlement's status (`requires_action`, `failed`, `pending`) with the matching control. Nothing outside the Usage view reads them.

The page builder's Announcement section (`LandingAnnouncement.vue`) is the site's strip banner: a badge, a line, a link and a ×, remembered for the session once dismissed. When it is the first section on the page it hands its height to the site header (`--sitehead-top`) so the header sits below it.

## Decisions

**One banner, the Announcement strip.** The shell renders `UsagePaymentAlert.vue` above every page, and it renders `LandingAnnouncement` with two new props: `tone="alert"`, a red band (`var(--danger, #a32222)` — the red the checkout and billing pages already use — with white text, a white badge and link), and `remember=false`, so the × hides it for this page view and stores nothing. Both default to today's behaviour, so every existing Announcement is unchanged. The page builder's editor gains no fields: an author never needs an error banner.

**When it shows.** A pure module, `@platform-kit/kit/lib/usage-alert.js`, holds the two rules the banner and its test share: which statuses need the customer (`requires_action`, then `failed`; `pending` does not), and which paths the banner stays off (`/checkout/`, `/embed/`, `/__preview`, `/__share`). The quiet list for ads and chat (`interrupt.js`) is deliberately not reused: a payment alert is the customer's own business, and belongs on their app, their spaces and the admin too, where an ad never may.

**Asking the server.** `usage-topup` gains an `attention` action, answered straight after the sign-in check: the signed-in customer's own subscriptions, their settlements for the active provider in `requires_action` or `failed`, and back comes only `{ attention: 'requires_action' | 'failed' | null }`. It needs no catalog, customer lookup or payment-method call. The banner asks once when the app opens on a site with a published metered plan, again when the customer signs in, and follows the Usage view whenever it reloads its list (a window event, `pk:usage-attention`, carrying the statuses it just loaded). Navigating does not re-ask; it only brings a dismissed banner back.

**Header offset.** The Announcement takes the header offset when it is the page's first section. A page's own Announcement further down used to clear the offset on mount; it now clears only an offset it set, so the alert and a landing page's own announcement can coexist.

**Language.** "Payment needed" as the badge; one line per status, saying what is wrong in the customer's terms; "Review payment" as the link to `/billing#usage`. All copy lives in `content/ui/usage.md` under a new `alert` group.

**Data ownership.** The settlement records stay server-only; the browser receives one status word.

**Controls and motion.** The × is the Announcement's own, with its label from the strings. No motion: the banner is present on load, or appears once the answer arrives.

## Deliberately not built

- **No email.** Asked for separately if wanted; it needs a template, consent and send timing of its own.
- **No session-long dismissal.** The point is that an unpaid charge keeps being visible.
- **No polling.** The payment changes when the customer acts on the Usage view, which tells the banner; a check per navigation would be a function call per click.
