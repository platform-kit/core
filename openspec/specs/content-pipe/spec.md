# content-pipe

## Purpose

Every markdown file the admin edits — a core collection's, a custom model's entry, a form, a funnel, a design's subject, a strings scope, a test's bank — is a record of one registry and goes through one pipe: read by its model's grammar, checked by its model's fields and checks, drawn by its model's editor, written back by the same grammar, followed by its model's hook. One system with a core stack of models and the custom models as its extension, not eleven systems that happen to write markdown.

## Requirements

### Requirement: Every file the admin edits is a model in one registry

The admin SHALL hold one registry of models: the kit's core models (articles, books, companions, wiki, docs, pages, ads, products, collections, experiments, sessions, storefront, site, forms, funnels, blasts, emails, the strings scopes, the models), site-registered models, and every published custom model. Every model SHALL be the same record — `key`, `name`, `dir`, `title`, `fields`, `single`, `body`, `assets` (where an upload for one of its records lands: a folder under `content/uploads`, `/uploads/<folder>/<name>` its address — never a rule about how a field refers to a file, `media-library`) — and a core or site model MAY carry what a custom one cannot: a **grammar** (`parse(text) → { data, content, parsed }`, `serialise(record) → text`), an **editor** (a component for the record where a form from its fields is not enough), **checks** (beyond the fields, with the site's other files in hand), **actions** (named operations on a record or a set), and an `after` **hook** run once a save has landed. A model with none of those SHALL be a plain form over frontmatter and a body, which is what every custom model is.

#### Scenario: the registry

- **WHEN** `/__admin/collections` is read on a site
- **THEN** it lists the platform's core models, the registered site's models, and every published custom model with their fields; on the demo, only core and demo-registered models appear

Verified by: `build/pipe.test.mjs` (the registry fixture); the admin rail screenshotted

### Requirement: One pipe, every model

Every model SHALL be served by the same six endpoints — `list`, `file` (read, write, create, rename, delete), `preview`, `upload`, `options`, `action` — and no model SHALL have an endpoint of its own; `/__admin/forms`, `funnels`, `emails`, `strings`, `models`, `print` and `quiz` SHALL go, their work in their models' grammar, checks, actions and hook. A write SHALL run the model's grammar, the fields' check, the model's checks, the write, then the hook, in that order, and SHALL refuse before writing with every fault named by field. The admin SHALL have one client for the pipe, and every editor SHALL load and save through it.

#### Scenario: the endpoints

- **WHEN** the admin server's routes are listed
- **THEN** they are the six, `asset`, `upload-image`, `run` and nothing else

Verified by: `build/pipe.test.mjs` (the route table); `grep` for the retired paths across the theme, none

#### Scenario: a save runs the pipe

- **WHEN** a funnel with an `after` that is not a span is saved
- **THEN** the write is refused naming the step and the field, the file is untouched, and the hook (the funnels' compile) did not run

Verified by: `build/pipe.test.mjs` over a fixture site

### Requirement: The files are unchanged by the change

Every grammar SHALL be the module that writes the file today, unmoved. A file the admin wrote, opened and saved with nothing changed, SHALL be byte for byte the file; a file written by hand SHALL come back with its meaning whole — every key, every value, the body — and in its model's canonical form from then on (the frontmatter's YAML as the writer lays it out, which is what the admin has always done to a hand-written file on save) — for every model, over the whole of `content/` in the demo and a representative site fixture.

#### Scenario: the round trip

- **WHEN** every file under `content/` that a model owns is read through its model and written back unchanged
- **THEN** no file loses a key, a value or its body; a file already in canonical form does not differ at all

Verified by: `build/pipe.test.mjs --roundtrip` against the demo and a representative site fixture (in `npm test` for the fixtures; manual site verification is not pinned)

### Requirement: Nothing a person sees changes

The rail, its views, every editor's controls and every file's shape SHALL be as they were: the page builder, the form builder, the chapter editor, the companion editor, the strings editor, the funnel and blast editors, the email designs, the print editions, the quizzes, the models builder, the generic grid and drawer. The core models SHALL be listed under Models as *core*, their fields shown and not editable; the builder SHALL edit custom models only.

#### Scenario: every editor, before and after

- **WHEN** each editor is opened on the same record before and after the change
- **THEN** it looks and behaves the same, and a save writes the same file

Verified by: screenshots of every editor, both themes, compared with the ones taken before; the round trip above
