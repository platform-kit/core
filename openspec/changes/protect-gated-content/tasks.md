# Tasks

## 1. The split

- [ ] 1.1 Split each gated record at build time into its public record and its gated remainder (books by chapter allowance for guests; gated articles, wiki and docs pages whole), and build the bundle, pre-rendered pages, search data, share images and sitemap from the public record only. Verified by `node build/gated-content.test.mjs` (task 4.1) finding no gated sentence in any published file.
- [ ] 1.2 In cloud mode, keep the gated remainder out of rows a visitor can read, with administrators still seeing it for preview. Verified by `node build/reader-content.test.mjs` in cloud mode.

## 2. The server answer

- [ ] 2.1 Add the `reader-content` function: the caller's class from their entitlements, raised to paying for an owned book, then the access bar and chapter allowance; text or a refusal with no text. Verified by `node build/reader-content.test.mjs` for a guest, a signed-in non-member, a book buyer, a member, and a forged or expired session.

## 3. The readers and the admin

- [ ] 3.1 Have the book, article, wiki and docs readers fetch gated text when the reader has access, with "Opening this chapter…", a retry error, and the next chapter fetched ahead; keep every existing paywall and ownership state. Verified by the rendered reader for a member, a buyer and a guest at 1280×900 and 390×844 in light and dark, and with the request blocked.
- [ ] 3.2 In the static shape, leave gated text out of the build, list the records left out, and show the notice on a gated record in the admin. Verified by `node build/gated-content.test.mjs` in the static shape and the rendered admin editor.
- [ ] 3.3 Put the new copy in the theme's strings. Verified by `node build/strings.test.mjs`.

## 4. Tests and documentation

- [ ] 4.1 Add `build/gated-content.test.mjs` (build the demo with gated fixtures; search every published file, pre-rendered page and search data for each gated sentence; repeat in the static shape) and `build/reader-content.test.mjs` (the readers and sessions above, in both repository and cloud shapes), and register them in `test.mjs`. Verified by running them.
- [ ] 4.2 Update the documentation that describes access and the readers (the access and content pages under `sites/docs/content/docs`), and FEATURES.md's access line, which currently says gated text is still in the published files. Verified by `node build/docs-check.mjs`.

## 5. Verify

- [ ] 5.1 Run both new tests, the strings test, `openspec validate protect-gated-content --strict` and the docs check, and inspect the rendered states. Report each scenario as passed, failed, or not verified, with the reason.
