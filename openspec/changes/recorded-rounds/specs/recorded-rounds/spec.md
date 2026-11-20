## ADDED Requirements

### Requirement: A person may choose to record a run

The question runner SHALL record a run only when its host passes a recording the person chose. A host that offers recording SHALL ask with the runner's `record` screen, listing no recording and each kind offered. Recording SHALL be offered only where the browser can encode H.264. A person who refuses the device permission SHALL continue unrecorded and be told so. The person SHALL be able to stop recording during the run without ending the run.

#### Scenario: opting in to video

- **WHEN** a host offers voice and video and the person chooses video and allows the camera
- **THEN** the run is recorded from before the first screen to after the last, and an indicator shows while it records

Verified by: DharmaLab's Abundance diagnostic driven in Chromium with a fake camera

#### Scenario: no choice, no recording

- **WHEN** the person chooses No thanks
- **THEN** no device is asked for and nothing is recorded

Verified by: the same, choosing No thanks

### Requirement: A recording is H.264, marked at every screen, and leaves the measurement unchanged

A recording SHALL be one fragmented MP4 per run: H.264 video with AAC sound, or AAC alone for voice. It SHALL be marked for every screen with when it was shown and answered, relative to the recording's start. The answers and their timing SHALL be recorded exactly as without a recording.

#### Scenario: marks match the answers

- **WHEN** a person answers every statement of a recorded round
- **THEN** the recording has one mark per answered statement, and its file plays as H.264 video

Verified by: a recorded round in Chromium, its file read back with mediabunny (`avc` and `aac` tracks)

### Requirement: A recording is kept as it is made

A recording SHALL be uploaded in parts while the run is under way, and the parts in order SHALL be the file. A run left before its end SHALL keep every part that arrived and SHALL be listed as partial.

#### Scenario: the tab closes mid-run

- **WHEN** a person closes the tab halfway through a recorded run and later opens their recordings
- **THEN** the recording is listed as partial and plays up to the last part that arrived

Verified by: a recorded round in Chromium, closed mid-way

### Requirement: A recording is private unless a form shares it with its staff

A recording and its files SHALL be readable and deletable by the person who made it. No other account SHALL read them, administrators included, unless the recording was made for a form that sets `#! record-staff = read`, in which case administrators SHALL be able to read it. The instrument's recordings SHALL always be private.

#### Scenario: another person, and an administrator

- **WHEN** another person or an administrator asks for an instrument recording's row or its file
- **THEN** both are refused

Verified by: the policies exercised as each role on the development database, inside a transaction rolled back

### Requirement: Recordings are kept by membership

With `keep: { days, afterMembership }`, a recording SHALL be deleted, with its files, when it is more than `days` old, its owner holds no live membership, and any membership they held ended more than `afterMembership` days ago. Answers and results SHALL never be deleted by this.

#### Scenario: a free reader, a member and a former member

- **WHEN** `keep` is `{ days: 90, afterMembership: 90 }` and the sweep runs over three recordings, each 120 days old: one by a person who never had a membership, one by a current member, and one by a member whose membership ended 100 days ago
- **THEN** the first and third are deleted with their files, the second is kept, and everyone's answers remain

Verified by: `run_recordings_due` on the development database, inside a transaction rolled back

### Requirement: A person can watch a run back by statement and delete it

The kit SHALL list a person's recordings and play one with a chapter for every marked screen, showing the host's text and answer label for it, and seeking to it when chosen. A person SHALL be able to delete one recording or all of theirs.

#### Scenario: jumping to a statement

- **WHEN** a person opens a recording and chooses the third statement
- **THEN** playback moves to the moment it was shown, and that chapter is highlighted with the answer they gave

Verified by: a recording played back in Chromium
