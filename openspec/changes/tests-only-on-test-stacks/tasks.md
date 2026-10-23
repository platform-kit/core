# Tasks

- [x] 1.1 `build/test-guard.mjs`: a test process (a test file, or a child of one) reaches only the run's verified `pk_<site>_e2e` stack, and nothing outside the run. `stackOf()` reads only the runner's addresses and checks both API and database ports with Docker; `supabaseUrl()` and `serviceKey()` do the same in a test. Verified by `build/test-stack.test.mjs`, including a running dev stack refused by name.
- [x] 1.2 `build/test-coverage.test.mjs` holds every test but the helper's own away from the unverified reader. Verified by running it.
- [x] 1.3 The testing documentation says so. Verified by `node packages/kit/build/docs-check.mjs`.
