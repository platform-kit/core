# Proposal

## Why

The end-to-end run built fresh stacks but ran the code in the developer's checkout: its installed packages, files a dev build had generated, and the site's functions folder, which the stack served through a link. A dev server running alongside rewrote that folder mid-run (its functions' data), the run's functions restarted, and a test failed with a 503 that had nothing to do with the code. Content compiled by an earlier dev build also stood in for the run's own: in a clean copy the drop-in scripts would not build at all.

## What Changes

- The run copies the checkout as git sees it — tracked files and new ones, never what `.gitignore` names (installed packages, builds, caches, generated data) — with each fetched site and the settings files the tests need.
- The copy installs its packages from scratch (`npm ci`), and the whole run happens from inside it: stacks, functions, app and tests.
- The run compiles each site's content and runs its prepare steps itself, as `platformkit build` does, instead of relying on output an earlier build left.
- The copy is removed when the run ends, unless `--keep`.

## Non-goals

- Changing what a run tests or how its stacks are built.
