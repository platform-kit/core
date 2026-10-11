# enrichment

## Purpose

A book in, its introduction and companion out — a sequence of narrow paid model calls, each cached and verified before the next, under a spend guard, run one sample at a time until a change is proven, because reruns once cost $130.

## Requirements

### Requirement: One sample, shown, approved, then the rest

A change to a prompt, a transport or a batching SHALL be run on ONE sample — one chapter with `--chapter`, or one short book — read, shown, and waited on before any second book, parallel run or whole-library pass; never a whole book rerun to test wording; nothing at all while James has said stop; the cost tally each run prints is part of the report.

#### Scenario: an unproven prompt change

- **WHEN** a brief in `build/briefs.mjs` or `build/voice.mjs` changes
- **THEN** the next run is `--chapter <one>` and its output is shown before anything else runs

Verified by: the working rule (no automation; by design)

### Requirement: Seven stages, each cached

`build/enrich.mjs` SHALL run understand → introduce → extract → write → audit → book lines → assemble, each stage's output cached in `build/.cache/<slug>.json` under a hash of its inputs and prompt version, so a rerun redoes only what changed; chapters travel together up to `SOURCE_CAP` words of source; the audit loop runs until clean and at most two more rounds on style, capped at eight write calls and `--max-spend` (default $1.00) per book per run, keeping the best-audited draft with its residual findings in the log and the review page.

#### Scenario: a dropped connection

- **WHEN** a run fails mid-book
- **THEN** the next run resumes from the stage that failed, paying for nothing already cached

Verified by: `build/enrich.test.mjs` — a stage whose inputs have not moved is read back and costs nothing; an edited chapter invalidates its own stage and NOT the reading of the whole book; a changed prompt version invalidates everything under it; and a run that died halfway keeps every stage it finished and invents none it did not

### Requirement: The output is in the file's own shape

The companion SHALL be written through `build/companion-io.mjs` in the same grammar the admin edits and velite reads, the introduction into the book's `introduction` field with `introduced` as provenance; hand edits survive reruns because only changed stages are redone; `build/enrich-review.html` is read before a run is trusted.

#### Scenario: the written companion

- **WHEN** a run writes with `--write`
- **THEN** `node build/companions.test.mjs` passes on the result

Verified by: `npm test`

### Requirement: The admin runs the same script

The Books grid's Enrich and Introductions only SHALL run `enrich.mjs` (with `--stage introduce` for the latter) on the ticked books and nothing else; there is no runtime generation.

#### Scenario: Enrich from the grid

- **WHEN** two books are ticked and Enrich pressed
- **THEN** the script runs for those two with the default spend guard and its log is shown

Verified by: the admin locally (no pinned test)

### Requirement: An enrichment run is a row, and the loop that walks it is the one that already exists

An enrichment run SHALL be an `agent_runs` row carrying a job (the script and its book) rather than a conversation, and the worker SHALL walk its stages with the same lease, cancel, step recording and spend accounting it uses for a bot. No second job table, lease or cancel SHALL be introduced.

#### Scenario: a worker dies mid-run

- **WHEN** the worker holding an enrichment run stops between stages
- **THEN** its lease expires, another worker picks the run up, keeps every stage already done, and carries on from the first one that is not

Verified by: `build/agents-db.test.mjs` (the job branch against the stack — a job run is queued, walks its stages in order, finishes, and its cache is the run's own state rather than a file); `build/enrich.test.mjs` ("a second worker does not discard what the first one paid for", "a run that died halfway keeps every stage it finished")

#### Scenario: an administrator stops a run

- **WHEN** `agent_cancel` is called on an enrichment run
- **THEN** it stops before the next paid call, keeps what it has done, and says it was cancelled

Verified by: `build/agents-db.test.mjs` — the one `agent_cancel`, proved on a run and the run stopping. There is deliberately no second test for a job: this requirement forbids a second cancel existing, so the same statement covers both branches by construction.

### Requirement: The stage cache is the run's, and the same shape as the checkout's

A stage's result SHALL be cached by a hash of its inputs and the prompt version, in the run's own state in cloud mode and in `build/.cache/<slug>.json` in a checkout, read and written through one accessor — so a rerun redoes only what changed and the two modes are one pipeline.

#### Scenario: a rerun after one chapter changed

- **WHEN** a book is enriched again with one chapter edited
- **THEN** only that chapter's stages are made again, in either mode

Verified by: `build/enrich.test.mjs` — "a stage whose inputs have not moved is read back rather than bought again", "a cache written by one is readable by the other", and both backings exercised through the one accessor (a mangled cache file reads as empty rather than stopping a run)

### Requirement: The spend rule holds wherever the run happens

A run started from the admin SHALL be one book; its cost SHALL be recorded on its steps as a bot's is, and the per-window ceilings SHALL count it. A whole-library pass SHALL remain a checkout's job.

#### Scenario: the admin asks for every book

- **WHEN** somebody tries to start a library-wide pass from the admin
- **THEN** it is refused, and the refusal says where that is run instead

Verified by: `build/enrich.test.mjs` ("a book cannot spend more than its budget" — the per-book guard checked before every paid call) and the one-book-per-run rule in `agent_job`. NOT VERIFIED: the library-wide refusal itself has no pinned test — it is the admin's own action and was checked by hand.

### Requirement: A deployment says yes to spending before a job starts

A provider key being present SHALL NOT be taken as consent to spend. A run SHALL be refused unless the deployment has said yes, per deployment, and the refusal SHALL say which consent is missing rather than the button being absent without explanation.

#### Scenario: real keys, no opt-in

- **WHEN** a deployment holds a provider key and has not said yes to spending, and Enrich is pressed
- **THEN** the run is refused as `not-opted-in` and the admin says what to switch on and where

Verified by: `agent_job`'s own guard, proved by pressing Enrich with real keys present and watching it refuse, then opting in and watching it start. The words are `not-opted-in` in the theme's `models` scope. NOT VERIFIED: no pinned test asserts the refusal — and this guard exists because it was missing and two unapproved runs bought about 27¢ of Anthropic while this was being built.

### Requirement: The admin's Enrich works in both modes, or says why not

The Books grid's Enrich SHALL start a run in cloud mode and in a checkout alike, show its stages as they land with what each cost, and offer to stop it. Where a deployment cannot run it at all — no provider, or no opt-in to spending — the button SHALL say so rather than be absent without explanation.

#### Scenario: a site in cloud mode with a provider

- **WHEN** an administrator presses Enrich on a book
- **THEN** a run is made, its stages appear as they finish, and the companion is written through the content store like any other file

Verified by: one book enriched end to end in cloud mode on 2026-10-02 — *The Golden Key*, 28 steps, 48.07¢ of a 60¢ cap, done with no error — and its companion read in full before it was trusted. NOT VERIFIED: the drawer's live stages have no pinned test and were checked by hand.

### Requirement: A run in the cloud writes a draft

What an enrichment run writes SHALL go through the content store, so that over rows it is a DRAFT: an introduction or a companion SHALL be where an administrator reads it and publishes it or does not, and SHALL NOT be visible to anybody until somebody says so. A run SHALL NOT be able to replace a published companion.

#### Scenario: a run against a library whose companions are hand-written

- **WHEN** a book that already has a published companion is enriched in cloud mode
- **THEN** the generated companion is a draft, the live version is byte for byte what it was, and nothing a reader sees has changed

Verified by: the 2026-10-02 run — the draft row held the generated companion while the live row stayed byte-identical to the hand-written one in the checkout, checked by comparing both against the file

### Requirement: Placement in PlatformKit

**Module switch:** enrichment.

**Layers.** core: the staged, cached, spend-guarded pipeline. theme: the admin's buttons. site: the voice and the briefs, the one-sample rule as a working rule.

**Extension points this needs:** the stages a configurable sequence (summarise and quiz alone for original content; the full rewrite pipeline for a classic); the voice a site brief.

**What the kit's module leaves to its comparable, on purpose:** no comparable — a pipeline, not a product.

This capability SHALL land in the layers above, SHALL be switched by its module, and SHALL expose the extension points named; a site SHALL keep its side as registrations, never as patches.

#### Scenario: original content

- **WHEN** original content
- **THEN** a site configures summarise + quiz and the pipeline runs without the introduce and rewrite stages

Verified by: the kit's CI against the demo, and the representative site fixture remains visually unchanged after the change
