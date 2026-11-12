# Proposal

## Why

Every end-to-end run of a checkout used the same container names, network, volumes and image cache, and a run began by removing whatever held those names. A second run of the same checkout (a second terminal, or a second agent session) therefore removed the first run's containers in the middle of its tests, and the first run failed for a reason that had nothing to do with the code. Two runs could not simply share the names either: two Docker daemons cannot use one image cache.

## What Changes

- A run takes the first free slot of its checkout: a lock file in the system's temporary folder that names its process. Its containers, network, volumes, image tag and image cache are named for that slot.
- Slot 0's names are the ones a run has always had, so a run alone is named and cached exactly as before. A second run at the same time takes slot 1, says so, and keeps an image cache of its own for next time.
- A slot whose process is gone (a crash or a kill) is taken over, and the run removes what was left in it, as a run always did. A slot that a live run holds is never touched.
- A run gives its slot back however it ends.

## Non-goals

- Changing what a run tests, or how its stacks are built.
- Sharing one image cache between runs.
