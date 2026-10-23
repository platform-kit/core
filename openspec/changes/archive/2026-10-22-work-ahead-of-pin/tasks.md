# Tasks

- [x] 1.1 Accept a checkout ahead of its pin and report how far; refuse one off the pin's line. Verified by `site-repositories.test.mjs`.
- [x] 1.2 Pin forward to a commit containing the checkout without changing it; refuse an update that would strand a local commit. Verified by `site-repositories.test.mjs`.
- [x] 1.3 Say it in `platformkit sites`, `platformkit dev` and the multiple-sites docs page. Verified by `node packages/kit/build/docs-check.mjs` and DharmaLab running in `npm run dev` two commits past its pin.
