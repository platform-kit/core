## Tasks

- [x] Foundation: `tsconfig.json` for the engine and the theme, `npm run typecheck` in CI and in the test run, `build/compile.mjs` on `prepack` and before a source install (with Node's own stripping where TypeScript is not installed), and the first `node:test` file (`typecheck.test.mts`)
- [x] The import convention: every import names the emitted `.mjs`; `build/workspace-ts.mjs` resolves it to the `.mts` in the workspace (the CLI, the git hooks, CI, the end-to-end image and container); the content pipe and `assemble`'s copies strip a TypeScript module; the generator reads one with its types blanked; Vite resolves the same way (`platformkit-typescript-names`)
- [x] Public types: `SiteConfig`, `defineSite`, `defineModule` (`src/config.mts`), the module manifest (`ModuleDeclaration`, `Module`)
- [x] `src/lib` and the shared modules the functions copy, converted
- [x] The engine and CLI modules, converted (four bootstraps stay JavaScript: `bin/platformkit.mjs`, `build/compile.mjs`, `build/workspace-ts.mjs`, `build/is-main.mjs`; `build/ts-migrate.mjs` and `build/vue-migrate.mjs` go when the conversion ends)
- [x] The theme: its modules converted, every component `<script setup lang="ts">`, published compiled for Node and as source for Vite
- [x] Docs: the build page, configuration, the CLI; source paths across the docs
- [x] The Edge Functions' JavaScript modules (`supabase/functions`), checked by `tsc` through `tsconfig.functions.json`; `deno check` over every function is still to do
- [x] The integration scripts and the tests, to TypeScript and under the strict check
- [ ] The tests that are not yet `node:test`, moved to it
- [x] The voice agent, the kit's fixtures and the generators that write the kit's own files
- [x] A site may be TypeScript (`platformkit.config.ts`, `build/site-file.mts`), and the workspace's sites are
- [x] The `from the conversion` markers, read and typed file by file (none left; `build/ts-migrate.mjs` and `build/vue-migrate.mjs` removed with them)
- [ ] What the conversion left as `any`, narrowed where a value's shape is known
- [ ] The full end-to-end suite on the converted kit
