# Design

## Context

- The access rule lives once in `packages/kit/supabase/functions/_shared/access.js` (the class ladder, `allowedBy`, `classOf`), shared by the browser (`src/lib/access.js`, which adds `chapterAllowance`) and the content API.
- `src/lib/access.js` calls itself "the cosmetic (v1) gate": velite compiles every record's full body into `.velite`, `#content` bundles it, the readers decide what to show, and pre-rendering and the search palette's data are built from the same records.
- The book reader (`BookReader.vue`) raises a reader to `paid` for a book they own (`hasProduct`), then applies `chapterAllowance` and `canAccess`.
- The server already holds every body. In the repository shapes the build writes the content index beside the functions (`build/content-json.mjs`, `_shared/content/index.json`); in cloud mode the `public.content` table holds the rows. The content API serves gated bodies only to keys allowed gated content.
- In cloud mode `content_select_published` lets anyone read published rows whole, and `content-live.js` loads them into the bundle, so gated bodies are readable there today.

## Decisions

**One split, at the content boundary.** The build produces two outputs from each record: the public record (frontmatter, title, description, chapter titles, free chapters and an ungated body) bundled as today, and the gated remainder kept only server-side. A record with no access bar is unchanged. For a book, the public record keeps chapters up to the guest allowance and replaces the rest with their titles and a `gated` marker; for a gated article, wiki or docs page, the body is replaced by the marker.

**Every public output is built from the public record.** Pre-rendering, search data (the palette's text and meaning vectors), share images, sitemaps and the bundle read the public record only, so no output can carry gated text by forgetting a filter. Search still finds a gated record by its title and description.

**One server answer per reader.** A `reader-content` function takes a record and, for a book, a chapter. It reads the caller's session, takes their class from `get_my_entitlements` (never from the request), raises it to `paid` for a book they own, applies `allowedBy` and `chapterAllowance`, and returns the text or a refusal with no text. It reads the body from the content index (repository shapes) or `public.content` with the service role (cloud). The browser reuses the same rule to decide what to ask for, so the paywall it draws matches what the server will give.

**Cloud rows.** Published rows readable by a visitor carry the public record; the gated remainder moves to a column or table only the service role and administrators read. `content_select_published` keeps its meaning for everything else, and an administrator's preview is unchanged.

**The static shape.** With no backend there is no one to ask, so the build leaves gated text out, reports the records it left out, and the admin editor shows the notice on a gated record. Publishing gated text openly was rejected: it is today's leak with a warning attached.

**Language.** "Opening this chapter…" while loading; "This chapter couldn't be opened. Check your connection and try again." with a retry on failure. A failed fetch never draws the paywall, because that would tell a paying reader they haven't paid.

**Data ownership.** The text stays the site's content, edited exactly as today; only where its gated part is published changes.

**Motion.** None beyond the loading line.

## Deliberately not built

- **Per-reader watermarking or anti-copy measures.** A reader with access can always copy what they see; the change is about readers without access.
- **Changes to the access rules.** The ladder, allowances and ownership rule are unchanged.
- **Offline reading of gated chapters.** A gated chapter needs a connection the first time it is opened.

## Risks

- A member waits for a gated chapter to load where it was instant. Mitigation: fetch the next chapter while the current one is read.
- An old cached bundle still holds gated text until it expires; a release note should say gated text published before this change remains in old copies.
