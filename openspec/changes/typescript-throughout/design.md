# Design

## Build and publish

Source is `.ts` (and `.vue` with `lang="ts"`). In the workspace, Node 22 strips types and runs the source directly, and Vite compiles the theme, so development has no build step. `tsc -p packages/kit` compiles to `packages/kit/dist/` with `.d.ts` beside each file, on `prepack` (npm publish) and `prepare` (an install from GitHub). The package's `exports` and `bin` point at `dist/`. Only erasable syntax is allowed (`erasableSyntaxOnly`), so the workspace and the published package run the same code.

## Order

1. Foundation: `tsconfig`, `typecheck` in CI, the publish build, `defineSite` and the public types. A site gets types before any internal file changes.
2. The libraries and shared modules (`src/lib`, the modules the functions copy), because both the browser and the functions run them.
3. The engine and CLI, directory by directory, with each directory's tests moved to `node:test`.
4. The theme, component by component.

Each step keeps every test green. A directory turns on `strict` when it is converted.

## What changes for references

Scripts are run by path all over: CI, the docs, the hooks and the tests. A converted script keeps its path with a `.ts` extension in the workspace and `.js` in `dist/`, and the CLI (`platformkit <command>`) stays the documented way to run anything, so most references move to it rather than to a path.
