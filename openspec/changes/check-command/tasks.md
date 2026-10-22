# Tasks

## 1. The command

- [ ] 1.1 Add `check` to `packages/kit/bin/platformkit.mjs`: checks as records (name, test, fix), all run, failures first, non-zero exit. Verified by `check.test.mjs`: two problems reported in one run; a clean site exits zero.
- [ ] 1.2 The machine, site, settings (through `deploy-checks.mjs`) and database checks. Verified by `check.test.mjs`: a manifest's new setting is asked for by both `check` and `deploy`.
- [ ] 1.3 `--online`: one read-only call per configured service, unreachable reported apart from refused. Verified by `check.test.mjs` against stub services, and with outside calls refused when the flag is off.
- [ ] 1.4 `dev` and `test` point to `check` when they can't start. Verified by `check.test.mjs`.

## 2. Docs and verification

- [ ] 2.1 The CLI reference and the getting-started page. Verified by `node packages/kit/build/docs-check.mjs`.
- [ ] 2.2 Report each scenario as passed, failed or not verified, with why. Verified by `verify.md`.
