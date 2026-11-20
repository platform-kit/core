# Tasks

## 0. Prove the real flow first

- [x] 0.1 H.264 and AAC encode through mediabunny in headless Chromium with a fake camera, written strictly in order. Verified by a probe page.
- [x] 0.2 Recording leaves the measurement alone. Verified in Chromium: while recording, the page handles a click with the same delay as without (median 0 ms, p95 0.1 ms), timers fire on time (p95 1 ms) and frames hold at 17 ms; the encoding runs off the main thread.

## 1. Groundwork

- [x] 1.1 `mediabunny` and `@mediabunny/aac-encoder` at 1.65.2, exact
- [x] 1.2 `run_recordings`, `run_recording_trash`, `run_recordings_due`, the bucket and its policies, with declared grants. `declarations.test.mts` 1377/0; `modules-off.test.mts` 66/0. The policies exercised as each role on the development database, rolled back: an owner reads their row and files; another reader reads nothing; an administrator reads nothing of a private recording and both of a form's shared one; an instrument recording can't be made staff-readable (the check refuses it, and an owner can't write `staff_read` at all).
- [x] 1.3 `instrument.record` and forms' `#! record`, `#! record-staff`, `#! record-keep`, `#! record-keep-after-membership`, with their refusals. `forms.test.mts` 317/317.
- [x] 1.4 `src/lib/recording.ts`: start, parts, marks, finish, close a partial.

## 2. The run

- [x] 2.1 The choice (`recordChoiceScreen`); the runner's `recorder` prop, marks, the indicator and Stop. Verified on DharmaLab's Abundance diagnostic in Chromium with a fake camera: 26 screens marked, two parts, the joined file read back by mediabunny as `video/mp4; codecs="avc1.640c1e, mp4a.40.2"`, 640×480, 34 s. No thanks records nothing.
- [x] 2.2 `FormRun` offers it for a form that sets `#! record`, saying so when its staff can watch. Verified on a temporary form in Chromium: recorded, complete, `staff_read`, named for its response.

## 3. Watching back and keeping

- [x] 3.1 `RecordingsList.vue` and `RecordingPlayer.vue`. Verified on DharmaLab, desktop and phone: the list, 25 chapters in the site's words and colours, choosing the third seeks to 6.2 s and highlights it; a round closed mid-way lists as stopped early and plays the 22 s that arrived; deleting removes the row and its files.
- [x] 3.2 The `run-recordings` function and its hourly job. Verified: `run_recordings_due` over a never-member, a member and a former member (ended 100 days ago), each 120 days old, and a never-member 30 days old, answers the first and third only; the sweep emptied the queued folders and refuses a call without the service key.

## 4. Docs

- [x] 4.1 Forms, forms internals, configuration, the configuration keys, the strings scopes. `docs-check` passes.
- [x] 4.2 Each scenario verified as named.
