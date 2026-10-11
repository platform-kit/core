# spoken-books

## Purpose

Every chapter and every summary spoken — made on a local CPU, named by the exact words so nothing is spoken twice, stored in the repository under LFS and served from the bucket, made in the reader's own browser when a recording is missing, and never required for a book to work.

## Requirements

### Requirement: The words and the names are one module

`src/lib/speech.js` SHALL be pure and shared by the script and the browser: `speakable` (markdown to speech), `bookChapters`, `chapterSpeech`, `hashInput`; a recording's name is sha1 of engine, voice, settings and the exact words (16 hex); a change to how words are prepared changes every name and is a whole respeak, never made in one place alone.

#### Scenario: the manifests

- **WHEN** `node build/speech.test.mjs` runs
- **THEN** every file name in every committed manifest is reproduced from the books and companions as they are, and the browser's weights list and revision equal the script's

Verified by: `npm test`

### Requirement: Nothing is ever trimmed

The engine SHALL speak pieces cut at sentence ends (300 characters) and the worker join them with the engine's gap; a recording's length is the samples it holds, never a sum of estimates.

#### Scenario: a long chapter

- **WHEN** a chapter of many pieces is spoken
- **THEN** its last words are present in the recording

Verified by: listening (the bug that ate last words is the reason; no automation)

### Requirement: The store is the copy of record, the bucket what is served

Recordings SHALL live in `audio/books/<slug>/` as LFS objects with `index.json` plain; the `audio` bucket is a sync target — after rendering, only what the bucket lacks is uploaded, fetching from LFS exactly those objects (`GIT_LFS_SKIP_SMUDGE=1` on a deploy box); every local run first pulls what its manifests name that the store lacks; each recording is uploaded the moment it is encoded and the manifest after it, so a cut-off run keeps its progress; `TTS_COMMIT=1` commits and pushes the store (a build box through a one-off token url, never stored).

#### Scenario: a deploy with nothing new

- **WHEN** `TTS=1` deploy runs and every manifest's recording is in the bucket
- **THEN** it spends under a second and speaks nothing

Verified by: NOT VERIFIED on a deploy box

### Requirement: The browser speaks what is missing, and shares it

A desktop browser (fine pointer, wide window, enough memory, no data saver, never the prerender) SHALL be offered Generate audiobook for a chapter with no recording: the weights (~400 MB, pinned revision) fetched once into the Cache API, Hugging Face first then the `models` bucket, prefetched quietly on the first non-landing page; the chapter spoken in a worker, cached at `/__audio/<hash>.mp3`; before generating, the bucket is asked for the name; a signed-in reader's finished chapter is uploaded under the same name (insert only, never replace); the script adopts bucket-made chapters into the store on its next run.

#### Scenario: a chapter another reader made

- **WHEN** a reader opens a chapter whose name is already in the bucket
- **THEN** it plays at once and is not generated

Verified by: `build/speech.test.mjs` — the name is stable across PEOPLE, not just across runs: the same words give the same recording whoever asks, an edited or retitled chapter is a different one, and a chapter’s summary never collides with its text

### Requirement: No manifest, no recording, no player

The reader SHALL mount the player only for a chapter and mode that has a recording; a book never needs audio to work; `IN_BROWSER_TTS=false` switches the browser voice off for everyone.

#### Scenario: a book with no manifest

- **WHEN** a book has no `audio/books/<slug>/index.json`
- **THEN** its reader shows no player and, on a desktop, offers to generate

Verified by: `build/speech.test.mjs` — an absent manifest, an empty one and one without this chapter are the same answer (no recording), and the introduction is keyed by a constant rather than by its editable label

### Requirement: Placement in PlatformKit

**Module switch:** tts.

**Layers.** core: the naming module, the script, the store and bucket sync, the browser engine. theme: the player and the generate offer. site: the store's recordings.

**Extension points this needs:** the voice and settings config; the module off removes the player, the generate offer and the deploy's TTS step.

**What the kit's module leaves to its comparable, on purpose:** ElevenLabs: no voice cloning, no API — a local model on the CPU and in the browser.

This capability SHALL land in the layers above, SHALL be switched by its module, and SHALL expose the extension points named; a site SHALL keep its side as registrations, never as patches.

#### Scenario: tts off

- **WHEN** tts off
- **THEN** no player, no offer, and the build reads no manifests

Verified by: the kit's CI against the demo, and the representative site fixture remains visually unchanged after the change
