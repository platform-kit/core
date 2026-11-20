# Design

## Principle: one recording per round, and the answers stay the source of truth

The instrument already records what was answered and when (`answers`: one row per statement, with `answered_at` and `latency_ms`), and works out a sitting from those times. A recording adds the picture and the sound of that same round. It needs no sitting id of its own. It carries the round's start and end, and a mark per statement saying when it was shown and answered, so playback finds each statement's moment by time and shows the answer the `answers` row holds.

## Why one continuous recording, not one per statement

- **The timing is the measurement.** A shadow is a pause before a yes. Starting a recorder at each statement takes a few hundred milliseconds and lands in exactly the gap being measured. A continuous recording takes nothing from the round.
- **The first word survives.** A recorder started as a statement appears misses the start of the reply.
- **One permission prompt**, one indicator, one thing to delete.
- **Watching back is one film with chapters**, the way a reader wants to see it, not forty clips.

## Configuration

```js
instrument: {
  module: './src/instrument/index.js',
  record: {
    kinds: ['voice', 'video'],   // what the reader may choose; omitted or [] = recording off
    keep: 0,                     // days a recording is kept; 0 = until the reader deletes it
  },
},
```

## The record: `round_recordings`

- `id`, `user_id`, `test` (the instrument's test, as `answers.test`), `kind` (`voice` | `video`), `mime`;
- `started_at`, `ended_at`, `duration_ms`;
- `parts` (how many have been uploaded), `bytes`;
- `marks` (jsonb): `[{ item, shown_ms, answered_ms }]`, offsets from the start of the recording, with `item` the `answers.item_id`;
- `status`: `recording` | `complete` | `partial`.

This is its own record because a recording has its own lifecycle (recording, complete, partial, deleted) that an answer doesn't have.

Grants and policies, declared beside the table: the reader may insert their own row, update it while it is `recording`, and select and delete their own rows. No other role reads it, administrators included. The service role does the sweep.

## The bucket: `recordings`

Private. Paths are `<user_id>/<recording_id>/<part>.<ext>`. The reader may insert, select and delete objects under their own folder, and nobody else may. This is unlike the `forms` bucket, which staff read: a form answer is sent to the site, but a round recording is the reader's own.

## The recorder (`src/lib/recording.ts`)

- `start({ kind })` asks for the microphone, or the camera and microphone, once, at the start of the round. If the reader refuses, the round goes on unrecorded and says so.
- `MediaRecorder` with a ten-second `timeslice`. Each part is uploaded as it arrives, in order, retried with backoff, and counted on the row.
- Video is captured at no more than 640×480 and about 1 Mbps (about 7.5 MB a minute); voice is Opus (about 0.5 MB a minute).
- `mark(item, 'shown' | 'answered')` records `performance.now()` offsets from the recorder's start. Nothing in the round waits on it.
- `finish()` flushes the last part, writes `ended_at`, `duration_ms` and the marks, and sets `complete`.
- A round left mid-way (tab closed, device asleep) stays `recording`. The next time the reader opens their recordings, the client sets it to `partial` with the parts that arrived.

## Watching back

- `RecordingsList.vue`: the reader's recordings, newest first, each with its date, kind, length and statement count, and a way to open or delete it. A site places it wherever its results live.
- `RecordingPlayer.vue`: fetches the parts as signed URLs and joins them into one Blob (parts from one recorder join into one valid file). Plays it in a `<video>` or `<audio>` element with a chapter list built from the marks. A site supplies, per item, the statement's text and how it was answered, so the kit shows the site's own words and colours. Clicking a chapter jumps to its `shown_ms`. The chapter being played is highlighted.

## The round's screens

When `instrument.record.kinds` isn't empty, the round's start screen offers a choice: no recording, or each kind offered. The reader's last choice is remembered on their device. While recording, a small indicator with a Stop button shows. Stopping ends the recording but not the round.

## Retention and deletion

- `keep > 0`: an hourly job (pg_cron through pg_net to `recordings-sweep`, as `session-recordings-retain` does) deletes rows older than `keep` days and their objects.
- The reader deletes one recording or all of them. Objects go first, then the row.
- When an account is deleted, its rows cascade, and the sweep removes objects with no row.

## To prove first

1. A Safari (WebKit) recording made with `timeslice` joins into a playable file. Chrome's WebM parts do. If Safari's MP4 fragments don't, the fallback is to upload one file at the end on Safari only, and say so in the docs.
2. Uploading a part every ten seconds to Supabase Storage keeps up on a phone connection.
3. Answer timing with a recording running matches timing without one, across a full round (the latency distribution compared).

## Not done

- Sharing a recording with a coach. A natural follow-up for coaching sites, but sharing is a separate act and gets its own record and consent.
- Transcripts.
- Recording a form as a whole, rather than one answer.
