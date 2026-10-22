# Proposal

## Why

The site's paywall only hides gated text. Every chapter and gated article ships in the site's published files, in its pre-rendered pages and search data, and, in cloud mode, in content rows that anyone can read. A technical visitor can read everything a member pays for. The content API already withholds gated bodies; the site's own pages do not.

## What Changes

- Published files, pre-rendered pages and search data carry only what a guest may read: titles, descriptions, free chapters and free articles. Gated text is never in them.
- A signed-in reader's gated text is fetched from the server after it checks their access by the same rule the reader sees today: the record's access bar, the book's chapter allowance for their class, and books they have bought.
- In cloud mode, gated bodies are no longer in content rows a visitor can read.
- The reader page shows the same paywall and "Yours — read it now" states as today; a reader with access sees the text after a short load.
- A static site has no server to ask, so gated text cannot be served there. The build leaves it out and lists which records are gated, and the admin says gated content needs a backend.

Proposed reader-facing copy, shown while a gated chapter loads and if it can't be loaded:

> Opening this chapter…

> This chapter couldn't be opened. Check your connection and try again.

Proposed admin copy, on a gated record in a static site:

> Gated content needs a backend. On a static site, this text isn't published at all.

## Non-goals

No change to the access rules themselves, the content API, or what guests see. No per-paragraph previews or watermarking.

## What James should look at

The static-site behaviour: gated text is left out entirely, rather than published openly with a warning. And the short load before a member sees gated text, which replaces today's instant display.

## Capabilities

### New Capabilities

- `content-access`: who may read a record's text on the site's own pages, and the guarantee that gated text never reaches someone without access.

### Modified Capabilities

None.

## Impact

- The build's content output, pre-rendering and search data; the book, article, wiki and docs readers; a server function that answers a reader's request for gated text; cloud mode's content read policy; the admin's record editor in the static shape.
- Surfaces to verify: the demo's published files scanned as a guest; a member, a buyer of one book, a signed-in non-member and a guest reading the same gated book; cloud mode's content rows as a guest; a static build with a gated record; the reader page at desktop and mobile in light and dark.
