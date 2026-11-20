# Tasks

## 0. Prove the real flow first

- [ ] 0.1 A WebKit `timeslice` recording joins into a playable file (else: one upload at the end on Safari, documented)
- [ ] 0.2 A part every ten seconds keeps up on a throttled phone connection
- [ ] 0.3 Answer timing with and without a recording, compared over a full round

## 1. Groundwork

- [ ] 1.1 `round_recordings` and the `recordings` bucket, owner-only, with declared grants; `declarations.test.mts`
- [ ] 1.2 `instrument.record` in the site config and its build refusals
- [ ] 1.3 `src/lib/recording.ts`: start, parts, marks, finish, recovering a partial recording

## 2. The round

- [ ] 2.1 The choice on the start screen, remembered per device; the indicator and Stop
- [ ] 2.2 The runner (`Typeform.vue`) records a run when its host passes `record`, and marks each screen at shown and answered, nothing waiting on the marks

## 3. Watching back

- [ ] 3.1 `RecordingsList.vue` and `RecordingPlayer.vue`, with the site's words per item
- [ ] 3.2 Deleting one or all; `recordings-sweep` for `keep`

## 4. Docs

- [ ] 4.1 The instrument documentation, the strings reference, the configuration keys
- [ ] 4.2 Each scenario verified as named
