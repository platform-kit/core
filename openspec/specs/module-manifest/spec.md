# module-manifest Specification

## Purpose

A module is the unit a site switches on or off, and this capability is the single declaration of
what each one IS. Before it, a module was described in four places that had to agree and did not:
the deployment matrix said what it does in each shape, the deploy said what environment it needs,
the build said which steps it runs, and the router said which routes it owns — four lists, four
chances to drift, and no way to tell which was right when they disagreed.

One manifest per module now says all of it, and everything else derives what it knows from there.
The matrix is no longer written down at all: it is worked out from the manifests and compared with
what the code can actually do, so a module claiming more than it delivers fails rather than
misleading somebody reading the table. A site can add a module of its own without the kit being
edited to permit it, and a mistyped module name is refused by name rather than quietly switching
the module ON.

## Requirements

### Requirement: A module says what it owns, in one place

Each module SHALL declare itself in one manifest naming what it owns — its routes, its admin
sections, its schema files, its edge functions, its cron jobs, its build steps, the environment
variables it needs, and any module it cannot work without. Each cron job SHALL declare a stable
name, a schedule and a database action, and exactly one module SHALL own each job. The enabled
kit, site and theme manifests SHALL be the only source used to assemble the scheduled jobs in the
database declaration; generated SQL SHALL be output, not a second hand-maintained list. Nothing
else SHALL hold a list of modules: the deployment matrix, the deploy's environment check, the
build steps and the router SHALL each derive what they know about a module from its manifest.

#### Scenario: a module's switch is read one way only

- **WHEN** anything asks whether a module is on without going through the one reading — a
  hand-written `modules.<name> !== false`, or a local binding that shadows the reading's own name
- **THEN** the build refuses it, naming the file and the line

Verified by: `build/manifests.test.mjs`, both halves proved by reintroducing each fault.

Note: this scenario replaces "a module named in two places", which asked for a sweep for a quoted
module id outside the manifests. That sweep cannot be written. The ids are ordinary words —
`docs`, `store`, `books`, `print`, `events`, `api`, `models` — and a sweep of the kit, the theme
and the site finds 1267 occurrences in 291 of 1005 files, almost none of them a module reference.
A check that cries wolf is one somebody switches off, which is why `store-separation.test.mjs`
keeps `book`, `cover`, `page` and `size` out of its own word list. What the sweep was FOR — a
module name nobody declares must never be read as ON, because `modules.stor !== false` is `true` —
is answerable, and is what is checked.

#### Scenario: a manifest that claims what it does not own

- **WHEN** a manifest names a route, a schema file, a function, a step or a scheduled job with an
  invalid schedule or action
- **THEN** the build refuses it, naming what is missing or invalid

Verified by: `build/manifests.test.mjs` and `build/cron-registration.test.mjs`.

#### Scenario: a declared job has one source

- **WHEN** an enabled kit, site or theme module declares a scheduled job
- **THEN** assembly includes that job from its owning declaration, and a duplicate name across
  modules is refused

Verified by: `build/cron-registration.test.mjs` with kit, site and theme fixtures.

### Requirement: A module answers for all three deployment shapes

Each manifest SHALL say what its module does in static, git and cloud — `true`, `false`, or an
exception naming the one operation it lacks, why, and the change that closes it. The deployment
matrix SHALL be built from those answers rather than written out, and a claim the code does not
back SHALL fail, in both directions: a module claiming cloud with a projected table and no
projection hook, and an exception whose gap has since been closed.

#### Scenario: a new module with no answer for a shape

- **WHEN** a manifest omits one of the three shapes
- **THEN** the build refuses it — a module answers for all three in the commit that adds it

Verified by: `build/modes.test.mjs`, which derives the matrix from the manifests

#### Scenario: an exception that is no longer true

- **WHEN** a manifest declares an exception whose gap the code has since closed
- **THEN** the check fails, because a feature nobody knows they have costs as much as one that is missing

Verified by: `build/modes.test.mjs` (the existing derivation, reading manifests)

### Requirement: Switching a module off removes exactly that module

Switching a module off SHALL remove everything its manifest claims — its routes, its admin
sections, its build steps, its deploy requirements, its nav items and its scheduled jobs — and
SHALL change nothing belonging to any other module. When the database declaration is applied,
jobs no longer declared by an enabled module SHALL be removed, while jobs owned by other modules
remain. A module that cannot work without another SHALL declare it, and the deploy SHALL refuse a
configuration that switches off something a live module needs, naming both.

#### Scenario: one module off

- **WHEN** any single module is switched off, every other left as it was
- **THEN** its own steps stop running, its own secrets stop being demanded, and its cron jobs are
  absent after the assembled database declaration is applied; no step starts, no step or job
  belonging to another module stops, and the deploy asks for nothing it did not ask for before

Verified by: `build/modules-off.test.mjs` and `build/cron-registration.test.mjs`, including a
database check that unrelated scheduled jobs remain.

#### Scenario: a module switched off that another needs

- **WHEN** a module is switched off while a module whose manifest names it as needed is still on
- **THEN** the deploy is refused, naming both modules and what to do about it

Verified by: `build/deploy-checks.mjs --test`; today's one real coupling (the instrument on the
forms module's runner) expressed as a manifest line rather than as a rule written into the check

### Requirement: A site or a theme may add a module

A site SHALL be able to register a module of its own, with its own manifest, and have it treated as
the kit's own are: a switch in the config, a row in the deployment matrix, its steps run, its
environment asked for, its routes answered and its scheduled jobs installed. A theme SHALL be able
to register its own module on the same terms. Adding either SHALL NOT require modifying any file of
the kit or the other package.

#### Scenario: a site's own module

- **WHEN** a site registers a module with a route, a build step, a scheduled job and an environment variable, and switches it on
- **THEN** the route answers and is prerendered, the step runs in its phase, the deploy asks for the variable, the job is installed, and the deployment matrix carries a row for it

Verified by: `build/site-module.test.mjs` against `sites/demo`, which registers one — a
separate file because modules-off.test.mjs and modes.test.mjs run against whatever site the suite
was started in; `build/cron-registration.test.mjs` for the site's job; the static lane, which
builds and walks that fixture with no backend

#### Scenario: a theme's own module

- **WHEN** a theme registers a module with a scheduled job and the site enables that module
- **THEN** the job is assembled and installed without a kit or site code change

Verified by: `build/cron-registration.test.mjs` with a theme module fixture

#### Scenario: that module switched off

- **WHEN** the same site or theme switches its own module off
- **THEN** its route stops answering, its step stops running, its variable stops being asked for, and its scheduled job is removed without changing other modules' jobs

Verified by: `build/site-module.test.mjs` and `build/cron-registration.test.mjs` against the same fixtures
