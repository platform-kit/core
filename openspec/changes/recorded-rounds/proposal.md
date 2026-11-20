# Proposal

## Why

A diagnostic asks the reader to say each statement out loud and notices where they hesitate or react. What the reader sees afterwards is a score and a list. They never see what actually happened: the pause before a yes, the voice that drops, the face that tightens. A recording of the round shows them, and watching an earlier round beside a later one shows them what has changed.

Forms already take a recorded answer: `VoiceInput` and `VideoInput` record one answer to one question and store it as a file. A round is different: dozens of statements in a few minutes, timed to the millisecond, because the timing is the measurement. Starting and stopping a recorder for each statement would cost a beat at each one, clip the first word, ask for the camera repeatedly, and leave a pile of files with nothing tying them together.

## What Changes

- **A round of the instrument can be recorded, if the reader chooses.** The site switches recording on and says which kinds it offers (voice, video or both). The reader chooses at the start of each round: no recording, voice or video. Recording is never on by default.
- **One recording per round, marked at every statement.** Recording starts before the first statement and stops after the last. Each statement adds a mark: when it was shown and when it was answered. The marks line up with the round's answers, so any moment in the recording can be traced to a statement and the answer given to it.
- **Recording doesn't change the measurement.** Answers and their timing are taken exactly as they are without a recording.
- **It is kept as it is made.** The recording goes up in parts while the round is under way, so a closed tab loses seconds, not the round.
- **Only the reader can watch it.** Recordings live in a private bucket the reader alone can read. Administrators can't watch them. A site can choose to delete recordings after a number of days; by default they are kept until the reader deletes them.
- **Watching back.** The kit provides a list of the reader's recorded rounds and a player. The player shows every statement as a chapter, along with the answer given to it, and jumps to any statement. The reader can delete one recording or all of them.
- **Forms are unchanged.** `VoiceInput` and `VideoInput` stay as they are.

## Capabilities

### New Capabilities

- `recorded-rounds`: an instrument round recorded by the reader's choice, marked at every statement, private to them, and watched back as chapters.

## Impact

- `platformkit.config.js`: `instrument.record` (`kinds`, `keep`).
- The instrument module: one table (`round_recordings`) and one private bucket (`recordings`), both with declared grants and owner-only policies; a scheduled sweep for `keep`.
- `src/lib/recording.ts`: the continuous recorder, its marks, uploading in parts, recovering a round left mid-way.
- The theme: the choice on a round's start screen, the "Recording" indicator, `RecordingsList.vue` and `RecordingPlayer.vue`, editable strings.
- The instrument and forms documentation.
