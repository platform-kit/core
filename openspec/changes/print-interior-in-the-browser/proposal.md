# Proposal

## Why

A site with no build machine sets its books in an Edge Function, which has two seconds of CPU per request. The steps after the interior fit easily, but the interior is one Typst compile: the book is one document, so its contents page and highlights index can name every page. A 164-page book's compile takes 1.74 seconds of CPU on its own, and with the setup before it the call goes past two seconds. A cut-off worker's job is retried, but each retry runs the same compile and is cut off the same way, so a long book can never be set in cloud mode. Hosted Supabase has the same limit.

## What Changes

- The function no longer compiles the interior. A set whose edition has no interior yet waits for one, in a new job state, `waiting`. The sweep and the lease leave a waiting job alone, and a second set of the same book joins it.
- The administrator's browser sets the interior. It asks the job for a handover: the source, the templates, the type as signed addresses, the binding rule and a signed address to upload to. It compiles with the same WebAssembly driver, uploads the PDF and hands the job back. The function checks the PDF's pages against the binding rule, then makes the EPUB and the covers.
- An interior, once set for an edition, is kept beside it in the bucket (`interior.json`), so any later set of that edition takes it back and never waits.
- The Print editions page does this by itself after a save, a render or a set, and shows each step.
- The Typst WebAssembly compiler becomes an ordinary dependency of the kit, because the admin bundle now needs it.

## Non-goals

- Changing how a machine sets a book: the native compiler still sets everything there, and nothing waits.
- Changing an edition's identity: the same text gives the same edition id, wherever it is set.
- Splitting the compile itself: the book stays one document.
