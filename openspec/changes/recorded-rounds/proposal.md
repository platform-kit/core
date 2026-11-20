# Proposal

## Why

A diagnostic asks the reader to say each statement out loud and notices where they hesitate or react. What the reader sees afterwards is a score and a list. They never see what actually happened: the pause before a yes, the voice that drops, the face that tightens. A recording of the round shows them, and watching an earlier round beside a later one shows them what has changed.

Forms already take a single recorded answer: `VoiceInput` and `VideoInput` record one answer to one question and store it as a file. A run of statements is different: dozens of statements in a few minutes, timed to the millisecond, because the timing is the measurement. Starting and stopping a recorder for each one would cost a beat at each statement, clip the first word, ask for the camera repeatedly, and leave a pile of files with nothing tying them together.

## What Changes

- **A run of the question runner can be recorded, if the person chooses.** The runner (`Typeform.vue`) is shared by forms and the instrument, so the recorder lives there. The page hosting the run offers the choice: no recording, voice or video. It is never on by default.
- **One recording per run, marked at every screen.** Recording starts before the first screen and stops after the last. Each screen adds a mark: when it was shown and when it was answered. The marks line up with the answers, so any moment of the recording can be traced to a statement and the answer given.
- **The measurement is unchanged.** Answers and their timing are taken exactly as they are without a recording.
- **H.264, always.** Video is H.264 with AAC sound, and voice is AAC, in a fragmented MP4, recorded through mediabunny in every browser. Where a browser can't encode AAC itself, mediabunny's AAC encoder stands in.
- **Kept as it is made.** A fragmented MP4 is written strictly in order, so each piece is uploaded as soon as it is made, and the pieces join into one file. A closed tab loses seconds, not the run.
- **Private by default.** Only the person who recorded can watch it. A form may choose to let its staff watch its recordings (`#! record-staff = read`). The instrument's recordings are always private.
- **Kept by membership.** A site sets how long recordings are kept. With `keep: { days: 90, afterMembership: 90 }`, someone without a membership has their recordings deleted 90 days after recording. A member's recordings are kept while the membership lasts, and deleted once it has been over for 90 days. Only the recordings go; answers and results are never touched.
- **Watching back.** The kit provides a list of a person's recordings and a player. The player shows every statement as a chapter with the answer given to it, and jumps to any statement. A person can delete one recording or all of them.
- **Forms can offer it too.** `#! record = voice | video | either` offers a whole-form recording. A single recorded answer (`VoiceInput`, `VideoInput`) is unchanged.

## Capabilities

### New Capabilities

- `recorded-rounds`: a run of the question runner recorded by the person's choice, in H.264, marked at every screen, kept by membership, private unless a form shares it with its staff, and watched back by statement.

## Impact

- `packages/kit` depends on `mediabunny` and `@mediabunny/aac-encoder` (exact versions).
- The forms module: `26-run-recordings.sql` (`run_recordings`, `run_recordings_due`, the `run-recordings` bucket's policies), the bucket row (`data/forms.sql`), the `run-recordings` function and its hourly job.
- `src/lib/recording.ts`: the recorder, its marks, uploading in parts, recovering a run left mid-way.
- `theme/src/instrument/ui/Typeform.vue`: the `record` prop, the marks, the indicator and Stop; a `record` screen kind for the choice.
- `RecordingsList.vue` and `RecordingPlayer.vue`; the `recording` strings.
- Configuration: `instrument.record` (`kinds`, `keep`); forms' `#! record`, `#! record-staff`.
- The forms and instrument documentation, the configuration keys.
