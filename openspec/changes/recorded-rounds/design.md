# Design

## Principle: one recording per run, and the answers stay the source of truth

The answers already record what was answered and when: the instrument's `answers` rows (`answered_at`, `latency_ms`), and a form's responses. A recording adds the picture and the sound of the same run. It carries the run's start and end and a mark per screen saying when the screen was shown and answered, so playback finds each statement's moment by time and shows the answer the host already holds.

## Why one continuous recording, not one per statement

- **The timing is the measurement.** A shadow is a pause before a yes. Starting a recorder at each statement takes a few hundred milliseconds and lands in exactly the gap being measured.
- **The first word survives.** A recorder started as a statement appears misses the start of the reply.
- **One permission prompt**, one indicator, one thing to delete.
- **Watching back is one film with chapters.**

## Where it lives: the runner

There is one question runner, `Typeform.vue`. Forms run on it through `FormRun.vue`, and the instrument runs its statement screens on it, which is why the instrument's manifest requires the forms module. So the recorder belongs to the runner, and its record and bucket belong to the forms module.

- The runner takes an optional `record` prop from its host: `{ kind, source, ref, staffRead }`.
- It starts the recorder before the first screen and finishes it after the last. It marks each screen as shown when it appears and as answered when its answer is emitted, by the screen's id (a statement's item, or a form slide's id).
- While recording, it shows a small indicator with Stop. Stopping ends the recording, not the run.
- The host decides whether recording is offered and asks with a `record` screen (No thanks / Voice / Video, only the kinds offered), then passes the choice in.

## Encoding: H.264 and AAC through mediabunny

- `Output` with `Mp4OutputFormat({ fastStart: 'fragmented' })`, which only ever appends, written to a `StreamTarget(writable, { chunked: true, chunkSize: 1 MiB })`.
- Video: `MediaStreamVideoTrackSource(track, { codec: 'avc', bitrate: 1e6 })` from `getUserMedia` at no more than 640×480 (about 7.5 MB a minute). Sound: `MediaStreamAudioTrackSource(track, { codec: 'aac', bitrate: 96e3 })`. Voice-only is the same without the video track (`.m4a`).
- `canEncodeVideo('avc')` must hold, or recording isn't offered on that browser. When `canEncodeAudio('aac')` doesn't hold, `registerAacEncoder()` from `@mediabunny/aac-encoder` is loaded first.
- Mediabunny is imported only when someone chooses to record, so nobody else downloads it.
- Proven in headless Chromium with a fake camera: H.264 and AAC encode, and the chunks arrive strictly in order.

## Keeping it as it is made

Each chunk the writable receives is uploaded as the next part, `<user_id>/<recording_id>/<nnnn>.mp4` (`.m4a` for voice), in order, retried with backoff, and counted on the row. Because the format only ever appends, the parts in order are the file.

`finish()` finalizes the output, uploads the last part, and writes `ended_at`, `duration_ms`, the marks and `complete`. A run left mid-way stays `recording`. The next time its owner lists their recordings, it is closed as `partial`, with its marks as they were last saved (they are saved with every part).

## The record: `run_recordings`

- `id`, `user_id`, `source` (`instrument` | `form`), `ref` (the instrument's test; a form's slug), `response_id` (a form's response, when there is one), `kind` (`voice` | `video`), `mime`;
- `started_at`, `ended_at`, `duration_ms`, `parts`, `bytes`;
- `marks` (jsonb): `[{ id, shown_ms, answered_ms }]`;
- `status`: `recording` | `complete` | `partial`;
- `staff_read` (boolean, false unless a form with `#! record-staff = read` made it).

It is its own record because a recording has a lifecycle (recording, complete, partial, deleted) that an answer doesn't have.

Grants and policies, declared beside it: the owner may insert their own row (with `staff_read` false for the instrument), update it while it is `recording`, and select and delete their own rows. Administrators may select a row only when `staff_read` is true. No other role reads it. The service role does the sweep.

## The bucket: `run-recordings`

Private, video/mp4 and audio/mp4 only. The owner may insert, select and delete objects under their own folder. Administrators may select an object only when its recording row says `staff_read`. Separate from `recordings`, which holds coaching calls.

## Keeping and deleting

`instrument.record.keep` (and a form's `#! record-keep`, same grammar) is `{ days, afterMembership }`:

- A recording is due for deletion when it is more than `days` old **and** its owner holds no live membership **and**, if they ever had one, it ended more than `afterMembership` days ago.
- `afterMembership` omitted: members are treated like everyone else.
- `keep` omitted: kept until the owner deletes it.

`run_recordings_due()` answers which rows are due. A membership's end is the latest of its subscriptions' `current_period_end` and its membership entitlements' `expires_at`. Hourly, pg_cron calls the `run-recordings` function through pg_net (as `session-recordings-retain` does). It removes the due rows' objects through Storage and then the rows, and removes objects whose row is gone (a deleted account). Answers and results are never touched.

A person deletes one recording or all of theirs from the list. Objects go first, then the row.

## Watching back

- `RecordingsList.vue`: the person's recordings, newest first, with date, kind, length and statement count, each opened or deleted, and Delete all. It closes any left `recording` as `partial` first.
- `RecordingPlayer.vue`: fetches the parts through signed URLs and joins them into one Blob, played in `<video>` or `<audio>`. Every mark is a chapter. The host passes, per id, the statement's text and how it was answered (a label and a colour), so the kit shows the site's own words. Choosing a chapter seeks to its `shown_ms`. The chapter being played is highlighted.

## Forms

`#! record = voice | video | either` offers a whole-form recording through the same `record` screen, before the first slide. `#! record-staff = read` lets the form's staff watch it, and `#! record-keep` sets how long it is kept. The recording names the response it belongs to.

## Not done

- Sharing a private recording with a coach.
- Transcripts.
- Requiring a recording to submit a form.
