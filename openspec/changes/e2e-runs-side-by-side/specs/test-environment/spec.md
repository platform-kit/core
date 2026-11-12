## ADDED Requirements

### Requirement: Two end-to-end runs of one checkout run side by side

A run SHALL take the first slot of its checkout that no live run holds, and its containers, network, volumes, image tag and image cache SHALL be that slot's. Slot 0's names SHALL be the checkout's own. A run SHALL never remove the containers of a run that is still going. A slot whose run has ended without giving it back SHALL be taken over, and what that run left in it SHALL be removed first. A run SHALL give its slot back however it ends.

#### Scenario: a second run while the first goes

- **WHEN** a run of the checkout is going and a second is started
- **THEN** the second takes the next slot, under names of its own, and both runs reach their tests

Verified by: `build/e2e-slots.test.mts`

#### Scenario: a run that crashed

- **WHEN** a slot's lock names a process that has gone
- **THEN** the next run takes that slot, and a slot a live run holds is never taken

Verified by: `build/e2e-slots.test.mts`
