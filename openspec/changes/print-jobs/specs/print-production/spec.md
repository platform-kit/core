## MODIFIED Requirements

### Requirement: A book is compiled a piece at a time, because two seconds is the budget

A Supabase Edge Function has 256 MB of memory, 400 seconds of wall clock and **two seconds of CPU per request**, and a cold worker can spend much of that loading the compiler. Setting a book in the cloud SHALL therefore be a job that outlives any one request: a record per set, leased to one worker at a time, with each step written down as it finishes (the interior, each cover, the EPUB). A step already finished for the same edition SHALL never be done again.

A request cut off part-way SHALL leave its job to be carried on: a sweep every minute SHALL ask again for any job whose lease has lapsed, and the next worker SHALL continue from the finished steps. The caller SHALL get the set's answer when it finishes in its own request, and SHALL be able to ask the job for it afterwards. An owner SHALL be able to cancel a set: no further step runs, and the files made for an edition the store does not sell are removed. A job that cannot finish SHALL be failed with its reason after five attempts.

The interior SHALL compile in one step: the book is typeset as one document, so its contents page and its highlights index can name every page.

#### Scenario: a worker times out mid-book

- **WHEN** a set is cut off after its interior is finished and its lease lapses
- **THEN** the next worker finishes it on its second attempt, with the same edition and pages, taking the interior back from the bucket rather than compiling it again

Verified by: `build/print-jobs-db.test.mjs` under `platformkit test --e2e`

#### Scenario: a piece that will not fit in two seconds

- **WHEN** a step is cut off by its budget again and again
- **THEN** the job is not left running for ever: after five attempts it is failed, with its reason

Verified by: `build/print-jobs-db.test.mjs` under `platformkit test --e2e`

#### Scenario: an owner cancels a render

- **WHEN** an owner cancels a job
- **THEN** no further step runs and the part-written edition is removed from the bucket

Verified by: `build/print-jobs-db.test.mjs` under `platformkit test --e2e`

#### Scenario: a lease still held

- **WHEN** a second call reaches a job another worker holds
- **THEN** it leaves the job alone and says the set is running

Verified by: `build/print-jobs-db.test.mjs` under `platformkit test --e2e`
