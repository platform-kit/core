# Proposal

## Why

Adding a site's own module today means copying the demo's `stockists` folder by hand: a manifest with seven fields, a page, an admin section, a build step, and four entries in the site config. A mistake shows up later as a refused build. Rails, Laravel and Loco each start new pieces from a command that writes files already in the right shape, and PlatformKit has nothing like it.

## What Changes

- A new command, `platformkit generate <kind> <name>`, writes the starting files for one piece of a site and wires it into the site config. The kinds:
  - **module:** a manifest answering all three deployment shapes, with its switch added to `modules` in the config, set to on.
  - **page:** a Vue page and its route, optionally under a module.
  - **content type:** a content model with a title field, editable in the admin.
  - **function:** a backend function with its manifest entry and a test that names it.
  - **test:** a test file in the form the structural checks accept.
  - **step:** a build step, registered in the config.
- Every file it writes passes the existing checks as written: the build, `platformkit test` and the structural checks.
- A site can override any template by placing its own at `generators/<kind>/` in its repository.
- It refuses to overwrite an existing file or reuse a module name, and it says what it wrote.
- `--dry-run` lists the files and config edits without writing them.

### The command's own words

Purpose: say what was written and the one next step, in one screen.

> Wrote module `{name}`: {files}. Switched on in platformkit.config.js. Next: `platformkit dev`, then open `/admin`.
>
> `{path}` already exists — nothing was written.
>
> No generator called `{kind}`. Kinds: module, page, content type, function, test, step.

## Non-goals

- Generating whole features such as a store or a forum. Those are the kit's modules.
- Editing code after the files are written. It writes new files and config entries only.
- An interactive prompt. Everything is arguments and flags.

## Review focus

That every generated piece passes the checks untouched, the config edits (they must keep the file's comments and order), and the override rule.

## Capabilities

### New Capabilities

- `kit-generate`: the generate command, its kinds, templates, overrides and refusals.

### Modified Capabilities

- `kit-cli`: "The commands" adds `generate`.

## Impact

- CLI: a new command in `packages/kit/bin/platformkit.mjs` and templates under `packages/kit/build/generators/`.
- Docs: the CLI reference and "Extending a site" pages.
- No change to any site until it runs the command.
