# kit-generate Specification

## Purpose
`platformkit generate`: a new module, page, content type, backend function, test or build step, written in the shape the checks accept and registered, in a site by default or in PlatformKit itself, without overwriting anything or disturbing the files it registers in.

## Requirements

### Requirement: Generate writes a site's new piece in the shape the checks accept

`platformkit generate <kind> <name>` SHALL write the starting files for one piece of a site, for the kinds module, page, content type, function, test and step, and SHALL add the piece's entries to the site config. Every file and entry it writes SHALL pass the site's build, `platformkit test` and the structural checks with no edit. It SHALL print each file it wrote and each config entry it added, then one next step.

#### Scenario: a new module

- **WHEN** `platformkit generate module stockists` runs in a site
- **THEN** a manifest answering all three deployment shapes is written, `modules.stockists: true` is added to the config, and the site loads with the module on

Verified by: `build/generate.test.mjs`, generating into a copy of `sites/demo`

#### Scenario: every kind passes the checks as written

- **WHEN** each kind is generated into a copy of the demo
- **THEN** the config loads with each piece registered, the page compiles, the steps pass the step check, the function is assembled and the test passes, with nothing edited by hand

Verified by: `build/generate.test.mjs`

#### Scenario: the config keeps its comments

- **WHEN** a generator adds an entry to a config file with comments
- **THEN** every comment and the order of every existing entry are unchanged

Verified by: `build/generate.test.mjs`, comparing the config before and after

### Requirement: Generate writes at the site level by default, or in PlatformKit itself

Generate SHALL take `--level site` or `--level core`, defaulting to `site`. At the site level it SHALL write into the site's repository and register every kind through the site config, with no change to PlatformKit. At the core level it SHALL write into `packages/kit` in PlatformKit's own form, including a stub docs page naming the new sources, and every file SHALL pass the kit's checks and the docs check with no edit. The core level SHALL be refused, writing nothing, outside a PlatformKit checkout.

#### Scenario: no level given

- **WHEN** `platformkit generate page about` runs in a site
- **THEN** the page is written in the site and registered in its config, and PlatformKit's files are unchanged

Verified by: `build/generate.test.mjs`

#### Scenario: every kind at the core level

- **WHEN** each kind is generated with `--level core` into a copy of `packages/kit`
- **THEN** the kit's structural checks and the docs check pass on the copy with nothing edited by hand

Verified by: `build/generate.test.mjs`

#### Scenario: the core level in a site installed from npm

- **WHEN** `platformkit generate module stockists --level core` runs where there is no PlatformKit checkout
- **THEN** nothing is written, and the refusal says to leave the flag off to add to the site

Verified by: `build/generate.test.mjs`

### Requirement: Generate never overwrites

Generate SHALL refuse, writing nothing, when a file it would write already exists or a module name is already declared, and SHALL name the file or the module. With `--dry-run` it SHALL list the files and config entries it would write and change nothing. When the config is not an object literal it can edit, it SHALL write the files, leave the config alone and print the entries to add by hand.

#### Scenario: a name that is taken

- **WHEN** `platformkit generate module store` runs
- **THEN** nothing is written and the refusal names the existing `store` module

Verified by: `build/generate.test.mjs`

#### Scenario: a dry run

- **WHEN** generate runs with `--dry-run`
- **THEN** it lists what it would write and the site's files are byte-for-byte unchanged

Verified by: `build/generate.test.mjs`

### Requirement: A site overrides a generator's templates

A site SHALL be able to replace the templates for any kind by placing its own in `generators/<kind>/` in its repository; generate SHALL use the site's folder in place of the kit's for that kind.

#### Scenario: a site's own page template

- **WHEN** a site has `generators/page/` and runs `platformkit generate page about`
- **THEN** the page is written from the site's template, not the kit's

Verified by: `build/generate.test.mjs`
