## Tasks

- [x] Foundation: `tsconfig.json` for the engine and the theme, `npm run typecheck` in CI and in the test run, `build/compile.mjs` on `prepack` and before a source install (with Node's own stripping where TypeScript is not installed), and the first `node:test` file (`typecheck.test.mts`)
- [x] The import convention: every import names the emitted `.mjs`; `build/workspace-ts.mjs` resolves it to the `.mts` in the workspace (on NODE_OPTIONS from the CLI and in the end-to-end container); the content pipe copies a TypeScript module stripped; the generator reads one with its types blanked
- [x] Public types, part one: `SiteConfig`, `defineSite` and `defineModule` (`src/config.mts`); the module manifest (`ModuleDeclaration`, `Module`) and the module system (`build/modules/{manifest,kit,backend}.mts`), `cron.mts`, `module-drop.mts`
- [ ] Public types, the rest: registries, theme contract, payment and printer adapters
- [ ] `src/lib` and the shared modules the functions copy
- [ ] The engine and CLI, by directory, tests to `node:test`
- [ ] The theme, by component
- [ ] Docs: the file map, configuration, extending a site; PLATFORMKIT.md
