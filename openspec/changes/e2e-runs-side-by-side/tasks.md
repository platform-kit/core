## Tasks

- [x] `build/e2e-container.mts`: `takeSlot()`, its lock file and its release on exit; every name of the run is the slot's, and slot 0 keeps the checkout's own
- [x] `build/e2e-slots.test.mts`, in npm test: a second run takes the next slot, a dead run's slot is taken over, a live one never is, a run releases only its own
- [x] Two runs of the club started together by hand, both passing and both cleaned up
- [x] Testing page
