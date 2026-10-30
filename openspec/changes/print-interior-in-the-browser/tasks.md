## Tasks

- [x] `44-print-jobs.sql`: the `waiting` state, counted as an open job; the sweep and the claim already leave it alone
- [x] `print-render`: no interior compile; an interior taken back from this job or from `interior.json`, checked when a browser hands one over, a handover with signed addresses, and otherwise the job waits; a waiting job is cancelled directly
- [x] `build/print/typeset/interior.js`: the browser's half (`setInterior`, `finishWaiting`) over the same WebAssembly driver, also run in Node by the tests
- [x] The admin function passes a waiting set through; the Print editions page sets the interiors in the browser, shows each step and asks again
- [x] `@myriaddreamin/typst-ts-web-compiler` an ordinary dependency of the kit
- [x] `print-jobs-db.test.mjs`: the waiting, the sweep leaving it, the join, the handover, a refused interior, a finished set, the same edition again; `print-cloud.test.mjs` finishes a waiting set as the page does
- [x] The end-to-end run keeps the functions' Deno cache between runs (every other volume of a stack is still new), so a slow connection does not time out the workers' boot
- [x] The browser half built into the admin bundle (the .wasm emitted as its own asset by `vite build`) and run in Chromium through the site's own Vite, from the admin bundle's imports (`build/fixtures/print-interior-browser.js`)
- [x] Print production, edge functions, print editions and testing pages; FEATURES.md
- [x] Every automated scenario verified under `platformkit test --e2e`: `print-jobs-db` 30/30 on the demo and on DharmaLab's 164-page book, `print-cloud` 45/45 and 46/46
- [ ] "Set the editions in cloud mode", by hand on the demo in cloud mode, with a screenshot of each state
