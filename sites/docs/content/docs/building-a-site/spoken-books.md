---
title: Spoken books
description: The text-to-speech pipeline — made locally, named by the text, stored in the bucket, generated in the browser where missing — and its rules.
order: 58
sources:
  [
    packages/kit/build/tts.mjs,
    packages/kit/build/tts,
    packages/kit/src/lib/speech.js,
    packages/kit/src/lib/speech/,
    packages/kit/src/lib/tts,
    packages/kit/theme/src/components/content/BookAudio.vue,
    packages/kit/theme/src/components/content/BookGenerate.vue,
  ]
reviewed: 2026-10-23
---

## The step

The deploy's side of it is a build step, `packages/kit/build/steps/tts.mjs`: phase `after`, module `tts`, `when` `TTS=1`, needing the service key and `SUPABASE_URL`, `git-lfs` on the path and the packages `onnxruntime-node` and `ffmpeg-static` — optional peers of the kit that a site with the module on names in its own `package.json`. `platformkit steps` shows it, `platformkit run tts` runs it alone, and the deploy checks ask for its needs only while `TTS=1`. See [the build steps](/content/docs/building-a-site/dev-build-and-deploy#the-build-steps).

## The script

`platformkit tts -- --book <slug>` (`--all`, `--chapter <title>`, `--summaries-only` / `--text-only`, `--dry`, `--local`, `--pull`, `--show`, `--workers N`, `--no-rebuild`) speaks every chapter of a book and every chapter summary in its companion with **Supertonic 3** (Supertone; OpenRAIL-M weights, the archived project's final revision pinned by `build/tts/setup.mjs`) on the CPU through onnxruntime-node — the engine code is the project's own Node example, vendored in `build/tts/supertonic/`. No Python, no GPU, no API, no cost; about four times faster than real time per engine; `--workers` runs several. `TTS_VOICE` picks the voice (M5, the warm soft-spoken one made for audiobooks; F5 its counterpart), `TTS_STEPS`, `TTS_SPEED`, `TTS_THREADS`.

`worker.mjs` is one engine speaking one chapter: the text cut into pieces at sentence ends (`chunkText`, 300 characters), each spoken whole, joined with the engine's gap of silence between. **Nothing is ever trimmed**: the model speaks in blocks of about 70 ms, a piece ends a fraction of a block early rather than mid-word, and summing those paddings and cutting them off the end of a chapter is the bug that once ate the last words of long chapters. A recording's length is the samples it holds.

## The words and the names are one module

`lib/speech.js` — pure, no imports — is shared by the script and the browser: `ENGINE`, `INTRO_KEY`, `speakable` (markdown → speech: headings as sentences, capitals as words, dashes as pauses, years in pairs, numbers in words), `bookChapters` (the split the reader makes), `chapterSpeech`, `hashInput`. Every recording is named by sha1 of `hashInput` (engine, voice, settings, the exact words; 16 hex), so text that has not changed is never spoken twice and a chapter a browser speaks has the same name the script would give it. `speech.test.mjs` reproduces every file name in every committed manifest from the books as they are. Never change how words are prepared in one place: change the module, and every existing name changes with it.

## The store, the bucket, LFS

The WAV is encoded as mono spoken word (ffmpeg, 128k) into the repository's store, `audio/books/<slug>/`: the MP3s as Git LFS objects, the manifest `index.json` (chapter title → the text's recording and the summary's; `__intro__` for the introduction) as a plain file. **Husky owns `core.hooksPath`, so Git LFS's own hooks are never installed: `.husky/pre-push` (and `post-checkout`, `post-merge`) hand off to `git lfs`** — without that pre-push a push sends pointers and not objects, and every clone fails to check out. The store is the copy of record; the public `audio` bucket is what readers are served from and is a sync target: after rendering, the script uploads only what the bucket lacks, fetching from LFS exactly the objects it needs (`GIT_LFS_SKIP_SMUDGE=1` on a deploy box). Every local run first pulls from the bucket whatever its manifests name that the store lacks. `TTS_COMMIT=1` makes a run that changed the store commit and push (`local` commits alone; a build box needs `TTS_GITHUB_TOKEN`). It commits as **platformkit tts** at a `platformkit.local` address — not as whoever happens to be logged in, so a recording committed by a build box reads as the build box; `TTS_COMMIT_NAME` and `TTS_COMMIT_EMAIL` override both. Each recording is uploaded the moment it is encoded and the manifest after it, never batched, so a cut-off run keeps what it finished.

Uploading needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The deploy runs `--all` against production only with `TTS=1`, then mirrors the browser's weights into the public `models` bucket.

**The warm-up never runs under automation.** Fetching the weights is about four hundred megabytes, started quietly the first time somebody lands on a page that is not a landing page, so that a chapter can be spoken without a wait. A driven browser never asks to hear anything, so it is pure cost there — and not a quiet one: it keeps the network busy for minutes, so any check that waits for the network to settle waits for a download nobody wanted. `navigator.webdriver` switches it off, which covers Playwright, Puppeteer, Selenium and the build's own crawler alike.

## The in-browser voice

The same model runs on onnxruntime-web: a desktop browser reading a chapter with no recording is offered **Generate audiobook** (`BookGenerate.vue`): it speaks the current chapter first, mounts the player, and goes on through every later chapter in the background; turning to a chapter mid-run moves it to the front. `IN_BROWSER_TTS=false` switches it off; it is never offered on a phone or tablet (`lib/tts/support.js`). The modules under `lib/tts/`: `weights.js` (the seven files, ~400 MB, fetched once into the Cache API — Hugging Face first, the `models` bucket as fallback — and prefetched quietly the first time a reader lands on a page that is not a landing page), `engine.js` (WebGPU when it works, WASM otherwise), `mp3.js` (a streaming lamejs encoder), `tts.worker.js`, `audiobook.js` (the queue and the cache; a finished chapter is put at `/__audio/<hash>.mp3`).

**The same worker also speaks for the assistant, and a conversation asks the opposite of a chapter.**
A chapter is made before anybody presses play, so it is packed into long pieces at full quality and
handed over once, finished. Somebody talking to an assistant is waiting, so `{ type: 'speak', live:
true }` makes the worker post **each piece the moment it exists** (`{ type: 'piece', pcm, rate }`,
float samples the page queues straight into its audio graph), cut for a fast start rather than for
throughput, and gives the opening piece a cheaper step count — see _Speaking to one_ under Bots for
the measurements that chose the numbers. `engine.call` takes `cut` and `stepsAt` for it.

The model ships **ten voice styles** (F1–F5, M1–M5) and reads **thirty-one languages**. Only the
style in use is fetched: each is 290 KB beside a 400 MB model, so there is no reason to download
the other nine until somebody picks one, and every reason not to, since most readers never will.
A chosen one is cached like any other weight and paid for once.

**None of that touches a chapter.** Without `live` the worker packs with `chunkText` at 300
characters, speaks every piece at the engine's own steps, and posts one finished mp3 — and it must,
because **a recording's name is a hash of the engine's settings**: a default changed here would
quietly rename every file in the store and the next run would speak the whole library again.
`build/speech.test.mjs` reproduces every committed name and is what holds that.

**The bucket fills as people read.** Before a chapter is made in a browser, the bucket is asked for its name (a HEAD, once per name): a recording any reader has already made plays at once. A chapter a **signed-in** reader's browser finishes is uploaded to the same place with its metadata; guests generate for themselves only. The policy lets the authenticated role insert under exactly that name shape and nothing else — never update, never delete — so a name once taken is never replaced by a reader. The script's `adoptFromBucket` makes browser-made chapters the copy of record on the next local run. The reader never writes a manifest; the script owns it.

## The player

velite reads each book's manifest into the book as `audio` (title → `{ full, summary }` urls); `BookReader.vue` mounts `BookAudio.vue` (wavesurfer.js: waveform, playhead, play/pause, time, speed) above the chapter bar where a recording exists for the chapter and mode. No manifest, no recording, no player.
