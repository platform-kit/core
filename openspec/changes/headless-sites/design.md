# Design

## Context

See proposal.md for why. Today:

- **Shapes.** `packages/kit/build/modes.mjs` declares static, git and cloud. Each manifest answers all three, and `modes.test.mjs` derives the matrix and fails a claim the code doesn't back.
- **The theme.** A site names it in `theme:` and can override any component or replace it whole (`theme-contract`). The admin (`AdminPage.vue`) and the API reference (`ApiReferencePage.vue`) are theme pages beside every reader page.
- **APIs that already serve other clients.** The content API (Contentful-compatible), store (Shopify), forms (Typeform), scheduling (cal.com), support (Chatwoot), Matrix, AT Protocol and analytics (PostHog). Each is reached over the backend functions with its own keys.
- **Sign-in.** Readers sign in through Supabase Auth, which any front end can call with the public key.

## Goals / Non-Goals

**Goals:** one switch; the admin, `/api`, embeds and hosted pages kept; every module's headless answer declared and checked; a named origin list.

**Non-Goals:** a front-end starter; headless without the admin; static headless. A static site has no backend to be headless about, so `headless` with `deployment: static` is refused.

## Decisions

1. **Headless is a fourth answer, not a fourth shape.** It combines with git or cloud: content still lives in the repository or in rows. So manifests gain a `headless` answer beside `static`, `git` and `cloud`, and `modes.test.mjs` derives it the same way. A module that owns reader routes and no API is `false`. Alternative: a fourth deployment shape. Rejected because where the content lives is a separate question from whether the kit draws pages.
2. **Every route says who it is for.** Routes gain a mark in their manifests: `reader` (the site's own pages), `staff` (the admin), `developer` (`/api`), `embed` (shown inside other websites: the comments embed, forms, the booking page, the support pop-out) or `hosted` (a page a front end sends people to: Hyperswitch checkout, the billing portal, the call room, sign-in callbacks, the cart hand-off). With `headless: true`, the router registers every route except `reader`, plus the root notice; prerender, the sitemap, share images and the phone probe skip. Scripts other websites load (the support snippet, the analytics script) are built as today. Alternative: a separate admin app. Rejected because the admin already lives in the theme and splitting it is a much larger change.
3. **One origin check for every function.** `_shared` gains the site's origin list from the config, and every function answers cross-origin requests only from it. Today each function sets its own CORS headers. Alternative: `*`. Rejected because cookie and token flows from any page on the web are what the access hardening closed.
4. **Exceptions are named, not guessed.** Support keeps its embedded widget, so it answers `true`. Spaces and coaching lose their community pages but keep their APIs (Matrix, and the coaching chat's functions), so each answers with an exception naming the page it loses and the API to use instead. The matrix tells a builder exactly what to build.
5. **The proof is the demo built headless.** A test builds a copy of the demo with `headless: true` and the `false` modules switched off. It checks that no reader page is emitted, that `/admin`, `/api`, the embeds and the hosted pages are, and that each `true` module's API answers from a listed origin and refuses another.

## Risks / Trade-offs

- **Reader email links** (confirm your address, reset password, receipts) point at reader pages that no longer exist. The site must declare where its front end handles them (`headless: { links: { confirm, reset, … } }`), and the deploy check refuses a headless site missing one.
- **Some answers will be exceptions for a long time.** That's acceptable as long as each names its gap and the matrix publishes it.
