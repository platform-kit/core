# Proposal

## Why

Adding a module today means copying the demo's `stockists` folder by hand: a seven-field manifest, a page, an admin section, a build step and four config entries. Rails, Laravel and Loco start new pieces from a command that writes them in the right shape. PlatformKit has none.

## What Changes

- A new command, `platformkit generate <kind> <name> [--level site|core]`, writes the starting files for one new piece and registers it. The default level is `site`, because most people build a site, not PlatformKit itself.
  - **site** (default): files go in the site's own repository and are registered in its `platformkit.config.js`. Every kind is already something a site can register, so nothing in PlatformKit has to open up.
  - **core**: files go in PlatformKit (`packages/kit`), in PlatformKit's own form, with a stub docs page since the docs check requires one. Refused outside a PlatformKit checkout, such as a site that installed PlatformKit from npm.
- The kinds:
  - **module:** a manifest answering all three deployment shapes, switched on in the config.
  - **page:** a Vue page and its route, optionally under a module.
  - **content type:** a content model with a title field, editable in the admin.
  - **function:** a backend function with its manifest entry and a test that names it.
  - **test:** a test file in the form the structural checks accept.
  - **step:** a build step, registered in the config.
- Every file it writes passes the existing checks as written: the build, `platformkit test` and the structural checks.
- A site can override any site-level template with its own in `generators/<kind>/`.
- It refuses to overwrite an existing file or reuse a module name, and it says what it wrote.
- `--dry-run` lists the files and config edits without writing them.

### The command's own words

Purpose: say what was written and the one next step, in one screen.

> Wrote module `{name}`: {files}. Switched on in platformkit.config.js. Next: `platformkit dev`, then open `/admin`.
>
> `{path}` already exists — nothing was written.
>
> No generator called `{kind}`. Kinds: module, page, content type, function, test, step.
>
> `--level core` writes into PlatformKit itself, and this isn't a PlatformKit checkout. Leave it off to add to your site.

## Non-goals

- Generating finished features, or editing code it didn't just write.
- An interactive prompt. Everything is arguments and flags.

## Review focus

That every generated piece passes the checks untouched at both levels, the config edits (comments and order kept), and the core-level refusal outside a PlatformKit checkout.

## Capabilities

### New Capabilities

- `kit-generate`: the generate command, its kinds, templates, overrides and refusals.

### Modified Capabilities

- `kit-cli`: "The commands" adds `generate`.

## Impact

- CLI: a new command and two template sets (site and core) under `packages/kit/build/generators/`.
- Docs: the CLI reference and "Extending a site" pages.
- No change to any site until it runs the command.
