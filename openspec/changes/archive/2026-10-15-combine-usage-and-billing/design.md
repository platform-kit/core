# Design

## Context

See [proposal.md](./proposal.md) for the reader-visible motivation and copy. The current Usage page owns usage loading and all payment and payout workflows inside its own layout; Billing owns membership reads and updates in a separate layout. The router currently normalizes `/app/billing` to `/billing`, while other `/app/...` paths remain application routes.

## Goals / Non-Goals

**Goals:**

- Reuse the existing Usage behavior inside the Billing page without changing its server contracts.
- Keep account navigation, fragment links, direct URL visits, and provider return URLs consistent.
- Ensure failed membership reads, failed membership updates, no membership, and usage errors remain visibly distinct.
- Make live Hyperswitch integration tests repeatable without making the normal test suite wait for Docker or a large service build.

**Non-Goals:**

- Changing membership, usage, top-up, payment-method, or payout APIs or their stored data.
- Changing provider checkout behavior or removing any usage-management capability.
- Changing account-page content owned by downstream sites.

## Decisions

### Render Membership and Usage as tabs inside Billing
Keep `/billing` as the shared account destination, but present Membership and Usage as separate accessible tabs rather than placing both panels inline. Membership is the default tab. Keep the Usage panel responsible for its existing balances, history, pack, incremental-payment, saved-method, top-up, and payout behaviors.
Refactor the existing Usage page content into an embedded panel and place it inside Billing's existing `SiteLayout` and themed page shell. Keep the Usage panel responsible for its existing balances, history, pack, incremental-payment, saved-method, top-up, and payout behaviors. Remove only its page wrapper, duplicate account navigation, and separate route rendering.
The Usage tab is relevant when the site has a published usage product or the signed-in reader already has usage balances, activity, or settings. If an account read fails before relevance can be determined, keep the tab available so the reader can see and retry the error. Membership is not a prerequisite. Keep the Usage panel mounted while switching tabs so its loaded state and provider-return handling are preserved; do not display its tab or panel to signed-out readers or readers for whom usage is not relevant.

Use the app's existing results-sheet navigation treatment: a plain, underlined tab row on wide screens and the established dropdown selector on narrow screens. When Usage is unavailable, show Membership directly without a redundant single-item selector.
**Alternative considered:** duplicate the Usage UI in Billing and leave the old page implementation behind. This would split behavior and allow states or payment flows to drift, so the existing content is reused instead.
**Alternative considered:** show Usage inline for every signed-in reader. This leaves an empty, irrelevant surface on sites without usage products and gives Usage equal visual weight to membership even when a reader cannot use it.

### Keep `/app/usage` as a redirect, not as a second page
Normalize the former route to Billing and replace its address with `/billing#usage`, carrying `location.search` through unchanged. A relevant Usage tab is selected for direct visits, internal links, hash changes, and browser history navigation. If usage is not relevant, keep Membership selected and do not show an unavailable tab.

**Alternative considered:** remove the route and let unknown paths fall back to `/`. That breaks bookmarked addresses and provider return URLs, so a compatibility redirect is safer.

### Track membership read state independently from update outcomes

Handle the entire authentication and membership-read path as a load operation. Read the signed-in reader's persisted active subscription independently of provider portal capabilities or secret configuration; a valid record must not become a false empty state or retry error. Keep successful `null` subscriptions as the genuine no-membership state; retain a separate error state and copy for failed reads. A successful update followed by a failed refresh must not be reported as an update failure. Show one combined sign-in prompt when signed out. Where the configured provider requires its hosted billing portal for management, use that provider flow rather than claiming a local cancellation update succeeded.

**Alternative considered:** use one generic error for every portal operation. It is simpler but reports the wrong action to the reader and conflates a failed request with a real empty state.

### Keep reader-facing words editable in the default theme

Put the combined heading, introduction, sign-in explanation, and separate membership-load/update messages in the existing UI content file. Do not add downstream-site-specific wording.

### Keep live Hyperswitch checks opt-in and container-backed

Add a repository-owned Docker Compose override for the upstream Hyperswitch v2 development stack, plus a named local integration command that accepts a private test profile file. The standard unit suite can include the live runner only when that file is explicitly configured. This keeps quick adapter tests and ordinary `npm test` runs independent of Docker availability, while giving developers a reproducible service image and v2 migration path for local integration checks. Do not commit merchant credentials or require provider secrets in CI.

**Alternative considered:** use only mocked Hyperswitch responses. Those are fast and remain the default, but cannot verify the adapter against a running router. Making the full service mandatory for every test run would make normal checks slow and environment-dependent.

### Keep tab visibility and membership states independently testable
Exercise visible/invisible Usage tabs with both configured usage offers and existing user data, including a user with no membership. Test membership reads for both supported provider paths, and verify that a genuine empty result is distinct from a rejected read.

## Risks / Trade-offs

- [Old provider return URLs may carry query values needed after redirect] → Preserve the entire search string and verify `payout_setup`, `payout_return`, `payout_cancel`, and `payment_method` through the route and browser probe.
- [Embedding a long-standing page can introduce layout conflicts with global section styles] → Reuse the existing responsive usage styles, scope the panel root explicitly, and inspect the combined page at mobile, tablet, and desktop widths in both themes.
- [The membership and usage tabs load independently] → Keep each tab's loading and error messages scoped to the data it represents; do not hide relevant usage because membership is empty or unavailable.
- [Hyperswitch integration startup may require a source checkout and Docker resources] → Keep it explicit, isolated under its own Compose project, and outside the default test path; document the exact setup and cleanup commands.

## Migration Plan

No data migration is needed. Ship the combined page and route alias together, then update account menus, editable strings, docs, and the earlier usage-route requirement. Rollback can restore the previous route branch and navigation link without changing persisted data.
