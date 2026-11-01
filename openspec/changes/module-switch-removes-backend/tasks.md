## Tasks

- [x] `core` named in `build/modules/backend.mjs`; every function, schema file and cron job owned by exactly one module or core; `manifests.test.mjs` fails on anything unowned, shown by planted files
- [x] Cross-module references moved into glue files owned by both (`supabase/schemas/glue/<a>+<b>.sql`, loaded after every module's file); `requires` where one module cannot exist without another (events and space encryption on spaces)
- [x] `assemble` omits what a disabled module owns, and glue files unless all owners are on; refuses a module on whose requirement is off; `--off` and `--out` assemble a variant
- [x] Run-time references in function bodies: each became a small function the asking module declares answering nothing, declared again in the glue; verified against the database by plpgsql_check and by re-creating every SQL function with its body checked
- [x] Rows and seed split by owner (`supabase/data/<key>.sql`, `supabase/seed/<key>.sql`)
- [x] The plan keeps a disabled module's tables and their rows (`keepOffTables`); `platformkit module drop <key>` removes them, behind the destructive guard
- [x] `modules-off-db.test.mjs`: each module off in turn, assembled and applied to a fresh database, bodies and cron checked; courses off with rows, on again, dropped
- [x] Docs: modules, the database, edge functions, the CLI reference, and the pages whose sources moved
