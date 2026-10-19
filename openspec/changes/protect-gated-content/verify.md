# Verification

Applied on 2026-10-18 at James's request. Not archived: read it, then `/opsx:archive`.

## Scenarios

| Scenario | Result | Evidence |
| --- | --- | --- |
| a guest scans everything the site publishes | **passed** | `node build/gated-content.test.mjs` (15 checks): a copy of the demo with a book a guest may read one chapter of, its companion, a paid article and a paid wiki page, built whole — content, prepare steps, bundle and the pre-rendered pages. No marker sentence (a locked chapter's ending, a short locked chapter, a locked summary, the article, the wiki page) appears in any published file; the free chapter and the locked chapters' titles do. |
| readers of the same book | **passed** | `node build/gate.test.mjs` (31 checks): each class's allowance, a bought book's lift to paying and its limit at a members-only bar, teasers never more than half a chapter. `node build/reader-content.test.mjs` (17 checks) on the local stack: the demo's members-only book sends a guest, `free@example.com` and the book's buyer no locked chapter whole, and a member every chapter. |
| a request without sign-in or with a forged class | **passed** | `reader-content.test.mjs`: a claimed class in the request is ignored; a broken session gets no locked chapter (the gateway refuses the malformed token before the function runs, so this check holds however the function answers). |
| cloud content rows | **passed** | `reader-content.test.mjs`: a visitor reads no row of `public.content` directly; the rows `reader-content` sends a visitor carry no locked chapter, locked summary or gated article text, keep the free chapter and the locked chapters' titles, and say which locked chapters have a quiz; an administrator is sent them whole. `build/entry.test.mjs` (80/80) holds the cloud adapter to the build's output with rows cut the same way. |
| a member opens a gated chapter | **passed** | rendered in a real browser on the demo at 1280×900 light and 390×844 dark: the member's chapter arrives from `reader-content` (one request per book) with its highlights, bottom line and quiz. |
| the fetch fails | **passed** | rendered with the request blocked, at 1280×900 light and 390×844 dark: "This chapter couldn't be opened. Check your connection and try again." with Try again, never the paywall. The same for a gated article: "This page couldn't be opened…". |
| a static build with a gated record | **passed** | `gated-content.test.mjs` in the static shape: the content builds, prints `[gate] a static site publishes no gated text — … gate-probe …`, and writes no marker. The record editor's access field says gated content needs a backend (field help in `build/models/core/collections.mjs`). |

A guest at 1280×900 dark and 390×844 light was shown the paywall as before. A temporary paid article on the demo was compiled without its body and shown to a paying reader after the fetch, to a guest as the paywall, and with the request blocked as the error line; it was removed afterwards.

The test was run against a server forced to send every chapter: it failed on the four cases where text would leak, then passed again with the server restored.

## Notes

- **Prefetch:** the reader fetches the whole book's allowed text in one request when the book opens, rather than one chapter ahead, so every allowed chapter is ready at once.
- **The wiki and docs reader:** it uses the same fetch helper as articles; it was not rendered separately.
- **Cloud mode and the gate marker:** while aligning the cloud adapter with the build, a real gap was found and fixed. A cut cloud row did not say where the cut started, so in cloud mode a member would have been shown each locked chapter's teaser as the whole chapter. Rows now carry `gatedFrom`.
- **Short locked chapters:** a teaser used to be the chapter's first 260 characters, so a short locked chapter was readable in full on the paywall. It is now never more than half the chapter.
- **Local database:** the declaration drops the old "anyone reads published rows" policy. The running local demo database had it dropped by hand to test; any other running database gets it at its next `platformkit migrate`.
- **Unrelated, pre-existing:** `store.test.mjs` passes 12 of 15. The three failures are `42P10` from the local Supabase Storage service on any upload with upsert, reproduced with a plain upload outside this change. The edited scenario (no visitor reads the content table) passes.
- **Unrelated, noticed:** the books docs say the store's unlock "opens it whole"; the reader lifts a buyer to paying for that book, which is the whole book only when no paid allowance is set.
