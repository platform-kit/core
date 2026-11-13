## ADDED Requirements

### Requirement: A module is one folder

Everything a module is SHALL live in that module's folder: its schema, rows, seed, functions, browser logic, pages, components, admin screens, default wording, content models, emails, build steps, integrations and tests. A file SHALL belong to the module whose folder holds it. A file outside every module folder SHALL be one of the kit's named shared mechanics, or be refused.

#### Scenario: a file in no module and not shared

- **WHEN** a file is added to the kit outside every module folder and is not named as shared
- **THEN** the manifests check fails, naming the file

Verified by: `build/manifests.test.mts`, with a planted file

#### Scenario: a module moved into its folder

- **WHEN** a module is moved from the old layout into its folder
- **THEN** the assembled backend is byte-identical with every module on and with each off in turn, and the built demo answers every route with the same page

Verified by: `build/assembled-tree.test.mts` and `build/module-routes.test.mts`

### Requirement: A module contributes and the kit composes

A module SHALL contribute its routes, admin sections, navigation, community places, member-card panels, build steps, content models, emails, default wording and scheduled jobs from its manifest, and the kit SHALL compose them. No kit file outside the module SHALL name the module's pages or components. A disabled module SHALL contribute nothing and its components SHALL NOT be in the built bundle. When two contributed routes match a path equally, the build SHALL fail.

#### Scenario: every path answered as before

- **WHEN** the demo is built with routes contributed by modules
- **THEN** every path the previous page chain answered is answered by the same page

Verified by: `build/module-routes.test.mts`

#### Scenario: two routes claim one path

- **WHEN** two modules contribute routes that match one path with equal precedence
- **THEN** the build fails, naming both

Verified by: `build/module-routes.test.mts`, with a planted pair

#### Scenario: a module off

- **WHEN** a module is switched off
- **THEN** none of its routes answer, its admin section and places are absent, and no file of its folder is in the built bundle

Verified by: `build/modules-off.test.mts`

### Requirement: Modules meet through slots and integrations

A module SHALL declare the named slots other modules may fill. What one module adds when another is on SHALL live in the adding module's integrations, and SHALL be installed only when both are on. A contribution to a slot no enabled module declares SHALL fail the build.

#### Scenario: an integration with its other module off

- **WHEN** courses is on and spaces is off
- **THEN** courses' spaces integration is absent from the assembled backend and the bundle, and courses works

Verified by: `build/modules-off-db.test.mts` and `build/modules-off.test.mts`

#### Scenario: a fill for a slot nobody declares

- **WHEN** a module contributes to a slot no enabled module declares
- **THEN** the build fails, naming the slot and the module

Verified by: `build/module-slots.test.mts`

### Requirement: A module has one front door

Each module SHALL export a public entry. Another module, the theme or a site SHALL import a module only through that entry, and the package SHALL export only the module entries and the named shared mechanics.

#### Scenario: an import past the front door

- **WHEN** a file imports a file inside another module's folder other than its entry
- **THEN** `platformkit check` fails, naming the import

Verified by: `build/module-boundaries.test.mts`, with a planted import

#### Scenario: a site imports an internal file

- **WHEN** a site imports a kit path the package does not export
- **THEN** the site's build fails to resolve it

Verified by: `build/module-boundaries.test.mts` against a fixture site

## MODIFIED Requirements

### Requirement: A site or a theme may add a module

A site SHALL be able to register a module of its own as one folder, from one entry in its configuration, and have it treated as the kit's own are: a switch in the config, a row in the deployment matrix, its contributions composed, its steps run, its environment asked for, its routes answered and its scheduled jobs installed. A theme SHALL be able to register its own module on the same terms. Adding either SHALL NOT require modifying any file of the kit or the other package.

#### Scenario: a site's own module

- **WHEN** a site registers a module folder with a route, an admin section, a build step, a scheduled job and an environment variable, from one configuration entry, and switches it on
- **THEN** the route answers and is prerendered, the admin section appears, the step runs in its phase, the deploy asks for the variable, the job is installed, and the deployment matrix carries a row for it

Verified by: `build/site-module.test.mts` against `sites/demo`; `build/cron-registration.test.mts` for the site's job; the static lane, which builds and walks that fixture with no backend

#### Scenario: a theme's own module

- **WHEN** a theme registers a module with a scheduled job and the site enables that module
- **THEN** the job is assembled and installed without a kit or site code change

Verified by: `build/cron-registration.test.mts` with a theme module fixture

#### Scenario: that module switched off

- **WHEN** the same site or theme switches its own module off
- **THEN** its route stops answering, its admin section and step are gone, its variable stops being asked for, and its scheduled job is removed without changing other modules' jobs

Verified by: `build/site-module.test.mts` and `build/cron-registration.test.mts` against the same fixtures
