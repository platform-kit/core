## MODIFIED Requirements

### Requirement: A book is compiled a piece at a time, because two seconds is the budget

A Supabase Edge Function has 256 MB of memory, 400 seconds of wall clock and **two seconds of CPU per request**, and a cold worker can spend much of that loading the compiler. Setting a book in the cloud SHALL therefore be a job that outlives any one request: a record per set, leased to one worker at a time, with each step written down as it finishes (the interior, each cover, the EPUB). A step already finished for the same edition SHALL never be done again, by this job or any later one.

A request cut off part-way SHALL leave its job to be carried on: a sweep every minute SHALL ask again for any job whose lease has lapsed, and the next worker SHALL continue from the finished steps. The caller SHALL get the set's answer when it finishes in its own request, and SHALL be able to ask the job for it afterwards. An owner SHALL be able to cancel a set: no further step runs, and the files made for an edition the store does not sell are removed. A job that cannot finish SHALL be failed with its reason after five attempts.

The interior SHALL compile in one step: the book is typeset as one document, so its contents page and its highlights index can name every page. Because that one compile can be longer than a function's budget, the function SHALL NOT compile it. A job whose edition has no interior SHALL wait for one, and the sweep and the lease SHALL leave a waiting job alone. The administrator's browser SHALL set the interior with the same WebAssembly compiler and the same type, from a handover the job gives: the source, the templates, the type, the binding rule and where to put the PDF. The function SHALL check the PDF it is handed against the edition and the binding rule before it takes it.

#### Scenario: a set waits for its interior

- **WHEN** a set reaches an edition with no interior
- **THEN** its job waits, a second set of the same book joins it, and neither the sweep nor a call without an interior moves it

Verified by: `build/print-jobs-db.test.mjs` under `platformkit test --e2e`

#### Scenario: the browser sets the interior

- **WHEN** the browser compiles the handover's source, uploads it and hands the job back
- **THEN** the job finishes with the interior's pages, and a later set of the same edition takes it back without waiting

Verified by: `build/print-jobs-db.test.mjs` and `build/print-cloud.test.mjs` under `platformkit test --e2e` (the browser's module run in Node, with the same WebAssembly)

#### Scenario: an interior that is not what it says

- **WHEN** the job is handed an interior whose page count is not the file's, or whose blank leaves are not the binding rule's
- **THEN** it is refused, and the job is failed with the reason

Verified by: `build/print-jobs-db.test.mjs` under `platformkit test --e2e`

#### Scenario: a worker times out mid-book

- **WHEN** a set is cut off after its interior is finished and its lease lapses
- **THEN** the next worker finishes it on its second attempt, with the same edition and pages, taking the interior back from the bucket rather than asking for it again

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

### Requirement: A cloud-only site can set an edition

A site with no build box SHALL be able to render, quote, validate and set every edition its books
offer, from the admin, with Supabase as the whole backend. The Print editions page SHALL show a
job's progress piece by piece and SHALL NOT offer an action that cannot be completed on that site.
When a save, a render or a set comes back with interiors waiting, the page SHALL set them in the
administrator's browser, saying which step it is on, and ask again.

#### Scenario: Set the editions in cloud mode

- **WHEN** an administrator of a cloud-only site presses Set the editions
- **THEN** a job is enqueued, the page sets the interior in the browser and shows it moving, and the editions land in the `print` bucket with their quotes, their titles and `print.json` written

Verified by: the demo in cloud mode, by hand, with a screenshot of each state

#### Scenario: the crop with no sharp

- **WHEN** a paperback's picture is cropped in a function
- **THEN** Storage's image transform does it, to the same dimensions the printer's cover asks for

Verified by: `build/print-cloud.test.mjs`
