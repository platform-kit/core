## Tasks

- [x] Foundation: `tsconfig.json` for the engine and the theme, `npm run typecheck` in CI and in the test run, `build/compile.mjs` on `prepack` and before a source install (with Node's own stripping where TypeScript is not installed), and the first `node:test` file (`typecheck.test.mts`)
- [x] The import convention: every import names the emitted `.mjs`; `build/workspace-ts.mjs` resolves it to the `.mts` in the workspace (the CLI, the git hooks, CI, the end-to-end image and container); the content pipe and `assemble`'s copies strip a TypeScript module; the generator reads one with its types blanked; Vite resolves the same way (`platformkit-typescript-names`)
- [x] Public types: `SiteConfig`, `defineSite`, `defineModule` (`src/config.mts`), the module manifest (`ModuleDeclaration`, `Module`)
- [x] `src/lib` and the shared modules the functions copy, converted
- [x] The engine and CLI modules, converted (four bootstraps stay JavaScript: `bin/platformkit.mjs`, `build/compile.mjs`, `build/workspace-ts.mjs`, `build/is-main.mjs`)
- [x] The theme: its modules converted, every component `<script setup lang="ts">`, published compiled for Node and as source for Vite
- [x] Docs: the build page, configuration, the CLI; source paths across the docs
- [ ] Type what the conversion left as `any` and the `from the conversion` markers, file by file
- [ ] The tests themselves to TypeScript and `node:test`
