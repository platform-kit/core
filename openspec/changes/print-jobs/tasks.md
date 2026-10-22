# Tasks

## 1. The job

- [x] 1.1 `print_jobs`, its claim and its sweep (`supabase/schemas/44-print-jobs.sql`), owned by the print module with its minute cron. Verified by `print-jobs-db.test.mjs`: no visitor reads, claims or sweeps.
- [x] 1.2 `print-render` opens or joins a job per set, claims its lease, writes down the interior, each cover and the EPUB as they finish, takes them back when resumed, checks for a cancel between steps, and records its result or its failure. Verified by `print-jobs-db.test.mjs` (20 checks) and `print-cloud.test.mjs` (45).

## 2. Docs and verification

- [x] 2.1 The print-production page describes the job. Verified by `docs-check.mjs`.
- [x] 2.2 Each scenario reported in `verify.md`.
