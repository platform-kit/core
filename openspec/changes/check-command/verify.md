# Verification

Run on 2026-10-22 against `sites/demo`.

| Scenario | Result | Evidence |
| --- | --- | --- |
| A key missing locally and in production | Passed | `check.test.mjs`: the demo build step's key is a warning by default and a failure with `--production`. |
| Two problems at once | Passed | `check.test.mjs`: Docker down and no browser, both reported with their fixes, and the run fails. |
| One list of needs | Passed | `check.test.mjs`: the key comes from the build step's own declaration, and `checkDeploy` (the deploy's path) asks for the same key. |
| Offline by default | Passed | `check.test.mjs`: with `fetch` replaced by a recorder, a full run without `--online` made no request; with `--online` the demo's configured services were asked. |
| A refused key | Passed | `check.test.mjs`: a 401 is reported as refused (failure); a network error as could not be reached (warning). |
| Check is a command | Passed | `platformkit check` in `sites/demo`: every machine, site and database check passed, with 12 settings warnings, exit 0. |

Also run: `test-coverage.test.mjs` (9/9), `docs-check.mjs` (88 pages), `openspec validate check-command --strict`.

`--db` was run on the demo's development database, which has drifted from its declaration (the plan holds REVOKE statements for grants the database has and the declaration doesn't). It reported "database schema — differs from the declaration" with the fix, and the run failed. Without `--db` no schema line is shown, since nothing was compared.
