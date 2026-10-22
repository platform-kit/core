# Verification

Applied on 2026-10-21 at James's request. Not archived: read it, then `/opsx:archive`.

| Scenario | Result | Evidence |
| --- | --- | --- |
| a worker times out mid-book | **passed** | `print-jobs-db.test.mjs` on a fresh demo stack: a job left with its interior done and its lease lapsed finishes on its second attempt with the same edition and pages, and the interior's stored file is untouched. |
| a piece that will not fit in two seconds | **passed** | A job past five attempts is failed with its reason. |
| an owner cancels a render | **passed** | A cancelled job stops on its next claim, says cancelled, and its files for an edition nobody sells are removed. |
| a lease still held | **passed** | A call to a job another worker holds answers 202 and leaves its attempts alone. |

The first run met the case itself: the test's first set reached a cold worker, the gateway gave up on the answer, and the job finished regardless (`done`, one attempt). The test now asks the job when an answer is lost. `print-cloud.test.mjs` passes 45 of 45 with the job in place. `test-coverage.test.mjs` no longer lists print jobs as a known gap.
