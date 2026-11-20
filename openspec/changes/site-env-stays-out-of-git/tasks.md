# Tasks

- [x] 1.1 `build/env-guard.mts`: the exclude rule, written once, and the refusal while a secrets file is tracked. Verified by `build/env-guard.test.mts` (5/5).
- [x] 1.2 Every `platformkit` command and every site `npm run dev` serves run it. Verified by running the CLI in DharmaLab's repository: the rule was written to its `.git/info/exclude`, and nothing was refused.
- [x] 1.3 The environment variables reference documents it. Verified by `packages/kit/build/docs-check.mts`.
