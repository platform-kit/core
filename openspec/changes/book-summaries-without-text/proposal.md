# Proposal

## Why

A site may want to offer a book's chapter summaries, key points and quizzes without publishing the book itself, for instance a book still in copyright whose author the site teaches from. Today a book's companion is published only beside the book's full text: velite drops a companion whose book is not published, and the reader, print editions and spoken books all assume the text is there. Withholding the text means withholding the summaries too.

## What Changes

- **A book can be marked `fullText: false`.** Its chapter titles, description, cover, introduction and companion (summaries, key points, quizzes) are published as usual. Its chapter text is never published and never sent, to any reader, whatever their class or purchase.
- **The text is withheld at every exit:**
  - the public record the build writes (the gate);
  - the server's content index;
  - the cloud rows a guest reads;
  - what `reader-content` sends a member.

  The book's file may hold the text while its summaries are being written. The build warns that it is there, so it can be removed once they are written.
- **The reader opens such a book in summary mode only**, with no switch to a full text. The cover shows how long the summaries take to read.
- **Print offers only the summary edition** of such a book, and a block that asks for any other edition is refused.
- **Spoken books record only the summaries** and the introduction.

## Non-goals

- Writing or generating any summary. How a site writes its companions is unchanged.
- A licensing or rights system. The flag says what is published, not why.

## Capabilities

### Modified Capabilities

- `content-access`: a book whose text is never published.
- `print-production`: such a book has only a summary edition.
- `spoken-books`: such a book is spoken only in summary.

## Impact

- `packages/kit/supabase/functions/_shared/gate.js`, `reader-content`, `build/content-json.mjs`, `build/velite.mjs`, `src/lib/print-offers.js`, `build/print.mjs`, `build/tts.mjs`, `theme/src/components/content/BookReader.vue`.
- The books page of the documentation site.
- No site changes. A book without the flag behaves exactly as today.
