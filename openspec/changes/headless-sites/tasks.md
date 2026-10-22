# Tasks

## 1. The answers

- [ ] 1.1 Add a `headless` answer to every kit manifest, and to the demo's `stockists`, with the derivation in `modes.test.mjs`. Verified by `modes.test.mjs`: a missing answer refused; a `true` claim with only reader routes refused.
- [ ] 1.2 Mark staff and developer routes (the admin, `/api`, the auth callbacks the admin needs). Verified by `manifests.test.mjs`.

## 2. The build and dev

- [ ] 2.1 `headless: true` in the config: the router registers only marked routes plus the root notice; prerender, sitemap, share images and the phone probe skip; refused with `deployment: static`. Verified by `headless.test.mjs` on a copy of the demo.
- [ ] 2.2 The build refuses switched-on modules that answer `false`, all named at once, and prints exceptions. Verified by `headless.test.mjs`.
- [ ] 2.3 `platformkit dev` serves the same set. Verified by `headless.test.mjs` starting dev on the copy.

## 3. The backend

- [ ] 3.1 One origin check in `_shared`, used by every function, reading `headless.origins` (and today's origin for sites that are not headless). Verified by `headless.test.mjs` against the stack: a listed origin answered, another refused; `function-bodies` and the existing e2e suite unchanged for ordinary sites.
- [ ] 3.2 Email links from `headless.links`, and the deploy check for missing ones. Verified by `headless.test.mjs` and `deploy-checks --test`.

## 4. Docs and verification

- [ ] 4.1 A "Headless sites" docs page and the module matrix's headless column. Verified by `node packages/kit/build/docs-check.mjs`.
- [ ] 4.2 Report each scenario as passed, failed or not verified, with why. Verified by `verify.md`.
