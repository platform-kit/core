# Design

## Build and publish

A file that runs in Node is `.mts` and compiles to the `.mjs` name it had as JavaScript, so every published path stays the same. A library shared with the browser is `.ts`, and a component is `<script setup lang="ts">`. A converted source imports its neighbours by their `.mts` or `.ts` names, and only erasable syntax is allowed (`erasableSyntaxOnly`).

- **In the workspace nothing is built.** Node 22 strips types and runs the source directly, and Vite compiles the theme. No `tsx` is needed.
- **For a site, the JavaScript is emitted.** Node never strips types inside `node_modules`, so `build/compile.mjs` compiles the kit with `tsconfig.build.json` on `prepack` and before a source install. It copies only what came from TypeScript beside its source (`x.mts` gives `x.mjs` and `x.d.mts`, with imports rewritten by `rewriteRelativeImportExtensions`), lists it in `.compiled.json`, and removes exactly that on `postpack`.
- **A source install from GitHub has no TypeScript installed**, since it installs no dev dependencies. There `compile.mjs` strips each file with Node's own `module.stripTypeScriptTypes` and rewrites the imports the same way. The declaration files come with the npm package.
- `compile.mjs` itself stays JavaScript, because it is what runs before anything is compiled.

## Checking

`npm run typecheck` runs `tsc` over the engine (`packages/kit/tsconfig.json`: `bin`, `build`, `src`, `vite`) and `vue-tsc` over the theme. Both are strict, and JavaScript not yet converted is allowed and not checked. The Edge Functions, and the Deno tests beside them in `build/`, are Deno's and are checked by `deno check`. `typecheck.test.mts` runs both checks and hands each a planted type error it must refuse.

## Order

1. Foundation: the configs, the typecheck in CI and in the test run, the publish build, and the first `node:test` file.
2. Public types: `defineSite`, manifests, registries, the theme contract, and the payment and printer adapters, so a site gets types before any internal file changes.
3. The libraries and shared modules (`src/lib`, the modules the functions copy).
4. The engine and CLI, directory by directory, each directory's tests moved to `node:test`.
5. The theme, component by component.

Each step keeps every test green.

## As built: the import convention

Every import, from JavaScript or TypeScript, names the file a site gets (`./site.mjs`), which is TypeScript's own convention: `tsc` reads `./site.mjs` as `site.mts`. So converting a file changes no importer and no export of the package. The workspace holds only the source, and Node never looks for a module under another extension, so `build/workspace-ts.mjs` — a `module.registerHooks` resolve hook — resolves a missing `.mjs` to the `.mts` beside it. The CLI puts it on `NODE_OPTIONS` for every process it starts, and the end-to-end runner passes it into its container. The content pipe copies a TypeScript module into the Edge Functions stripped of its types, under the `.mjs` name its importers use. This replaces the earlier plan of importing `.mts` names and rewriting them, which would have broken every JavaScript importer inside a site's `node_modules` and every workspace site reaching a converted file through the package's exports.
