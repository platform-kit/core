## ADDED Requirements

### Requirement: Generate writes a site's new piece in the shape the checks accept

`platformkit generate <kind> <name>` SHALL write the starting files for one piece of a site, for the kinds module, page, content type, function, test and step, and SHALL add the piece's entries to the site config. Every file and entry it writes SHALL pass the site's build, `platformkit test` and the structural checks with no edit. It SHALL print each file it wrote and each config entry it added, then one next step.

#### Scenario: a new module

- **WHEN** `platformkit generate module stockists` runs in a site
- **THEN** a manifest answering all three deployment shapes is written, `modules.stockists: true` is added to the config, and the site builds with the module on

Verified by: `build/generate.test.mjs`, generating into a copy of `sites/demo`

#### Scenario: every kind passes the checks as written

- **WHEN** each kind is generated into a copy of the demo
- **THEN** the build and the structural checks pass on the copy with nothing edited by hand

Verified by: `build/generate.test.mjs`

#### Scenario: the config keeps its comments

- **WHEN** a generator adds an entry to a config file with comments
- **THEN** every comment and the order of every existing entry are unchanged

Verified by: `build/generate.test.mjs`, comparing the config before and after

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
