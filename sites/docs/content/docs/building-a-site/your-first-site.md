---

title: Your first site
description: Create a PlatformKit site, install its dependencies, and run it locally or from its own repository.
order: 41
sources: [.nvmrc, sites/demo/platformkit.config.js, sites/docs/platformkit.config.js, packages/kit/bin/platformkit.mjs, sites/demo/package.json, package.json, packages/kit/build/sites.mjs]
reviewed: 2026-10-11
---

A site is an independently configured project built with PlatformKit. It contains its own package manifest and lockfile, `platformkit.config.js`, content, and any code or data it registers. The PlatformKit workspace also contains generic example sites; copy one as a starting point, then keep the new project's code and content in its own repository.

## The files

```text
my-site/
  package.json             exact PlatformKit package versions and site scripts
  package-lock.json        the dependencies used by local and production builds
  platformkit.config.js    modules, theme and site registrations
  index.html               the application shell
  vite.config.js           the kit's Vite plugin
  velite.config.js         content collections
  src/main.js              the theme entry
  src/looks/<name>.css     optional site palette
  src/<module>/            optional site-owned modules and components
  content/                 the site's records, pages and language strings
  db/                      optional site-owned schemas, rows and functions
  build/                   site-specific build scripts and tests
  openspec/                site-owned specifications and changes
```

`package.json` carries an imports map so the same code runs under Node and Vite: `#content` and `#site/*` resolve to the kit's Node fallbacks outside Vite. Declare optional peer packages needed by enabled modules in the site manifest. For example, email templates need `mjml`, print production needs `@myriaddreamin/typst-ts-node-compiler`, and spoken books need `onnxruntime-node` and `ffmpeg-static`. `platformkit test` and `platformkit steps --check` report missing packages for enabled features.

## The config

```js
export default {
  name: 'My Site',
  theme: '@platform-kit/movable-types',
  modules: {
    store: true, print: false, memberships: true, sessions: false, coaching: false, support: true,
    funnels: true, emails: true, forms: false, instrument: false, recommendations: false,
    translation: false, tts: false, enrichment: false, push: false,
  },
  looks: { mine: { css: './src/looks/mine.css' } },
  defaultLook: 'mine',
  nav: { links: [{ key: 'content', href: '/content', prefix: true }, { key: 'store', href: '/store' }] },
  languages: ['en'],
  data: { ports: 54360 },
}
```

Sites can disable modules they do not use, add their own modules and routes, or register theme overrides. Module switches also control which pages, admin sections, build steps and deployment settings apply. See [Configuration](/content/docs/building-a-site/configuration) and [Declarations and state](/content/docs/building-a-site/declarations-and-state).

## The palette

A look is a CSS file of tokens under `[data-look="mine"]`, including dark-theme values. A site can leave its look unset to use the theme's default palette. See [Looks and landing sections](/content/docs/building-a-site/looks-and-landing-sections).

## Running it

From an independent site checkout, install the committed lockfile and run the site's commands:

```sh
npm ci
npx platformkit dev
npx platformkit test
npx platformkit build
```

`platformkit dev` assembles the local Supabase project when the site needs a backend. `platformkit test` runs the kit checks relevant to the site's modules, the site's own tests, and its OpenSpec validation. `platformkit build` compiles content and produces the site's bundle and prerendered pages. Deploy only from the configured deployment environment, after its checks pass.

For a deployment, the site repository can invoke the Core CLI directly from GitHub:

```sh
npx --yes --package=github:platform-kit/core platformkit deploy
```

This sources the kit and theme from the Core repository, so npm publication is not required and the site's manifest and lockfile are not changed. When using npm-published PlatformKit packages instead, pin their exact versions and commit the matching `package-lock.json`. A standalone site build uses its own repository and dependencies; it does not need files from a sibling site. See [Dev, build and deploy](/content/docs/building-a-site/dev-build-and-deploy) and the [multi-site guide](/content/docs/running-a-site/multiple-sites) for local workspace development and repository fetches.

Use Node 22 for every command. The `platformkit` executable uses nvm to restart under Node 22 when available; otherwise install Node 22 or use the PlatformKit devcontainer.

The first `dev` or `migrate` writes `supabase/config.toml` from the kit's template with the site's id and port base. The rest of `supabase/` is assembled on every run from PlatformKit and site-owned declarations.

## What to do next

- Write `content/site.md` and the home page.
- Add the content collections the site needs; the admin can create and edit their files.
- If the site sells, define its offers and supply payment credentials only in the deployment environment.
- If the site sends email, configure the relay only in the deployment environment.
- Read [Dev, build and deploy](/content/docs/building-a-site/dev-build-and-deploy) before the first deploy; its checks name every missing requirement.