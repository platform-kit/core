## Tasks

- [ ] `core` manifest; every function, schema file and cron job owned by exactly one module or core; `manifests.test.mjs` fails on anything unowned
- [ ] Cross-module references moved into glue files owned by both; `requires` where one module cannot exist without another
- [ ] `assemble` omits what a disabled module owns, and glue files unless both owners are on
- [ ] Run-time references in function bodies split or guarded by the compiled module set
- [ ] The plan keeps a disabled module's tables and their rows; `platformkit module drop <key>` removes them, behind the destructive guard
- [ ] `modules-off-db.test.mjs`: each module off in turn, applied to a fresh database, functions booted
- [ ] Docs: modules, the database, deployment modes; FEATURES.md
