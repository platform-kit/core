# Tasks

## 1. The package

- [x] 1.1 Move the theme into the engine's package (`packages/movable-types/` to `packages/kit/theme/`), and make `packages/kit/package.json` the one package: name `platformkit`, the theme's dependencies merged, `./theme` and `./theme/*` exported ahead of the catch-all. Verified by `npm pack --dry-run` listing the theme and the site packages resolving `platformkit/theme/main.js`.
- [x] 1.2 Rename every import, dependency and config value: `@platform-kit/kit` to `platformkit`, `@platform-kit/movable-types` to `platformkit/theme`; paths `packages/movable-types` to `packages/kit/theme`. Verified by `one-package.test.mjs` (no old name outside history).
- [x] 1.3 The CLI's source route (`build/source-install.mjs`) installs the one package. Verified by `source-cli.test.mjs`.
- [x] 1.4 The release workflows publish the one package. Verified by reading them; they run on a tag.

## 2. The sites

- [x] 2.1 The workspace's sites depend on `platformkit`. Verified by `npm install` linking `platformkit` and the brochure site building.
- [x] 2.2 DharmaLab, in its own checkout and uncommitted: its dependency becomes `github:platform-kit/core#main`, its imports and theme name the new paths. Verified by its app compiling (`vite build`).

## 3. Docs and verification

- [x] 3.1 Docs: every page naming the old packages or paths. Verified by `docs-check.mjs`.
- [x] 3.2 `one-package.test.mjs`: the old names are gone, the packed package carries the theme and the command, and the command runs from the packed file. Verified by running it.
