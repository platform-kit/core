# admin-editing

## Purpose

How the admin edits the site's content: every value as a control that fits it, the files' grammars never shown, the words of the product editable in one place — so that an editor is never asked to type structured text, and a new editor is built to this rule from the start rather than corrected to it.

## Requirements

### Requirement: Structured data is edited as fields, never typed as grammar

The admin SHALL ask for each part of a structured value with a control that fits it — a span as a number and a unit, triggers as rows with a kind picked from a list, choices as a list of rows to add, reorder and remove, a rule as its own fields, prose in the markdown editor — and SHALL write the value back through the same pure function the build reads it with. The only free text in the admin is text that IS free: a title, a sentence, a line of prose, a path.

#### Scenario: a placeholder that teaches a syntax

- **WHEN** an editor's `<input>` or `<textarea>` has a placeholder or hint that describes a grammar (`3d`, `on-site 30s, …`, "a closing list is the choices")
- **THEN** it is a fault: the value gets its own control, and the grammar is written by the serialiser

#### Scenario: a round trip through the editor

- **WHEN** a value is saved from its controls
- **THEN** the file holds exactly what the build's parser would produce from the same value, and re-opening the editor shows the same controls filled the same way (`build/support.test.mjs`, `build/funnels.mjs --check`)

### Requirement: The admin reads the files, never the compiled output

The admin SHALL read and write the markdown files themselves, never `.velite`, so an unpublished file is edited like any other; and every read and write SHALL go through the file's model in the one registry (`content-pipe`) — its grammar, its fields, its checks, its hook — never through a path of its own, so that a file opened and saved unchanged is the file, byte for byte, whatever it is.

#### Scenario: an unpublished record

- **WHEN** a record has `published: false`
- **THEN** the admin lists it with its switch off and the bundle, the search index, the sitemap and the share images never see it

Verified by: `build/unpublished.test.mjs` — the record stays on disk and leaves the bundle, the index and the routes; the checkout is restored whatever happens

#### Scenario: one path

- **WHEN** a new kind of file is given to the admin
- **THEN** it is a model in the registry with a grammar and, if needed, an editor — never a new endpoint

Verified by: `build/pipe.test.mjs` (the route table)

### Requirement: A concept with its own lifecycle gets its own record

A thing that is created, changed and retired on its own schedule (an experiment, a companion, a print block's editions) SHALL be its own record and never fields on the thing it references.

#### Scenario: a new concept

- **WHEN** a feature needs to remember something about a page, a book or an offer that changes on its own timetable
- **THEN** it gets its own file or table pointing at the page, the book or the offer — never new fields on them

### Requirement: Every string the admin shows is markdown too

The admin's own labels, hints and empty states SHALL come from `content/app/ui/*.md` like the site's.

#### Scenario: a new admin panel

- **WHEN** a panel is added
- **THEN** its words are a `## group` in the right scope file, wired from the start

### Requirement: Placement in PlatformKit

**Module switch:** —.

**Layers.** core and theme together: the rule that structured data is edited as fields holds for every kit editor and every site editor alike.

**Extension points this needs:** none — it is a rule, carried by `kit-principles`.

**What the kit's module leaves to its comparable, on purpose:** —.

This capability SHALL land in the layers above, SHALL be switched by its module, and SHALL expose the extension points named; a site SHALL keep its side as registrations, never as patches.

#### Scenario: a site editor with a grammar input

- **WHEN** a site editor with a grammar input
- **THEN** the kit's verify pass fails it as it would its own

Verified by: the kit's CI against the demo, and the representative site fixture remains visually unchanged after the change
