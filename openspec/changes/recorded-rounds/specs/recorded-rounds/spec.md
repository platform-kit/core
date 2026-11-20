## ADDED Requirements

### Requirement: A reader may choose to record a round

When a site sets `instrument.record.kinds`, a round's start screen SHALL offer the reader no recording or each kind the site offers. Recording SHALL NOT start unless the reader chooses it. A reader who refuses the device permission SHALL continue the round unrecorded and be told so. The reader SHALL be able to stop recording during the round without ending the round.

#### Scenario: opting in to video

- **WHEN** a site offers voice and video and a reader chooses video and allows the camera
- **THEN** the round is recorded from before the first statement to after the last, and an indicator shows while it records

Verified by: a round driven in a browser with a fake camera (Chromium's fake media device)

#### Scenario: no choice, no recording

- **WHEN** a reader starts a round without choosing to record
- **THEN** no device is asked for and nothing is recorded

Verified by: a round driven in a browser

### Requirement: A recording is marked at every statement and leaves the measurement unchanged

A recorded round SHALL be one recording, marked for every statement with when it was shown and when it was answered, relative to the recording's start. The answers and their timing SHALL be recorded exactly as in a round with no recording.

#### Scenario: marks match the answers

- **WHEN** a reader answers twenty statements in a recorded round
- **THEN** the recording carries twenty marks, one per answered statement, each naming the statement and its shown and answered offsets

Verified by: `packages/kit/build/recording.test.mts` and a round driven in a browser

### Requirement: A recording is kept as it is made

A recording SHALL be uploaded in parts while the round is under way. A round left before its end SHALL keep every part that arrived, and SHALL be shown as partial.

#### Scenario: the tab closes mid-round

- **WHEN** a reader closes the tab halfway through a recorded round and later opens their recordings
- **THEN** the recording is listed as partial and plays up to the last part that arrived

Verified by: a round driven in a browser and closed mid-way

### Requirement: Only the reader can watch their recording

Round recordings and their files SHALL be readable and deletable only by the reader who made them. No other account SHALL read them, administrators included. A reader SHALL be able to delete one recording or all of their recordings. When a site sets `keep`, recordings older than that many days SHALL be deleted with their files.

#### Scenario: another account, and an administrator

- **WHEN** another reader or an administrator asks for a reader's recording row or its file
- **THEN** both are refused

Verified by: `packages/kit/build/recordings-db.test.mts`

#### Scenario: kept for a set time

- **WHEN** a site sets `keep: 30` and a recording is 31 days old when the sweep runs
- **THEN** the row and its files are gone

Verified by: `packages/kit/build/recordings-db.test.mts`

### Requirement: A reader can watch a round back by statement

The kit SHALL list a reader's recordings and SHALL play one with a chapter for every marked statement, showing the statement and the answer given to it in the site's own words, and jumping to a statement when it is chosen.

#### Scenario: jumping to a statement

- **WHEN** a reader opens a recording and chooses the seventh statement
- **THEN** playback moves to the moment that statement was shown, and the seventh chapter is highlighted with the answer they gave

Verified by: a recording played back in a browser
