# Proposal

## Why

Setting a book in the cloud ran in one Edge Function request. A request has two seconds of CPU, and a cold worker spends much of that loading the compiler, so a set could be cut off part-way and lost, with the caller told only that something failed. The specification promised a job system for this, a row per set with a lease and cancellation, and none was built.

## What Changes

- Setting a book is a job: a row per request, leased to one worker at a time, recording each step as it finishes (the interior, each cover, the EPUB).
- A set cut off part-way is carried on by the next worker from its finished steps, not from the start. A sweep every minute asks again for any job whose lease has lapsed.
- An administrator can cancel a set. It stops at the next step, and the files it made for an edition the store does not sell are removed.
- A job that cannot finish is failed after five attempts, with its reason, not retried for ever.
- The caller still gets the same answer when a set finishes in its own request, plus the job it ran as; a caller whose answer was lost asks the job.
- The specification's chapter-by-chapter compile is replaced by these steps: the book is typeset as one document, so its contents page and highlights index can name every page, and the interior compiles in one step.

## Non-goals

- Splitting a book's interior across requests.
- A new admin screen. The admin's existing set call is unchanged; job status can be asked by its id.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `print-production`: "A book is compiled a piece at a time, because two seconds is the budget" becomes a set run as a job of steps, resumable, cancellable and bounded.

## Impact

- Surfaces: `print-render` (the set call, `{ job }`, `{ job, cancel }`), the database (`print_jobs`, its claim and its sweep), the print module's cron.
- Docs: the print-production page.
