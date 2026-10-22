---
title: Content models
description: Any kind of content the site needs — teachers, events, testimonials — defined in the admin as a model of fields with rules, its entries edited as forms and kept as markdown, delivered as data, pages, JSON or a landing section.
order: 16
sources:
  [
    packages/kit/build/tags.mjs,
    packages/kit/theme/src/components/admin/ModelsAdmin.vue,
    packages/kit/theme/src/components/admin/ModelBuilder.vue,
    packages/kit/theme/src/components/admin/ModelField.vue,
    packages/kit/theme/src/components/admin/ModelLeaf.vue,
    packages/kit/theme/src/components/admin/GroupField.vue,
    packages/kit/theme/src/components/admin/RowsField.vue,
    packages/kit/theme/src/pages/EntriesPage.vue,
    packages/kit/theme/src/components/landing/LandingEntries.vue,
    packages/kit/theme/src/content/ui/models.md,
  ]
reviewed: 2026-10-01
---

The kit ships five kinds of content — articles, books, wiki, docs, pages. A **content model** is a kind of your own: a site that needs teachers, events, venues or testimonials defines each as a model in the admin — its fields, what each may hold, how it is delivered — and gets a full CMS over it: a grid and a drawer, a Published switch, and every entry a markdown file with frontmatter like the rest of the content. Module: `models` (on unless a site says otherwise).

Everything custom lives under `content/models/`: the model itself is `content/models/<key>.md`, its entries are `content/models/<key>/<slug>.md`, and its addresses are under `/c/`. Nothing a model is called can meet a built-in kind — a model named `books` sits beside the stock books, and neither notices the other.

## Defining a model

**Content → Models** lists every model in the collections' grid (its name, its fields and entries, how it is delivered, whether it is on); **New model** opens the builder on a blank one. The builder has three views — Fields · Options · Delivery — with **Published** beside them, and under it a bar with the model's **Name** (the plural: _Teachers_), its **Singular** (_Teacher_) and its **Key** (made from the name until saved; the folder and the address).

**Fields** is the list down the left (each by its label with its kind under it, marked _title_, _unique_ or _if_; drag a field by its grip to reorder it, × to remove it; **+ Add a field** in the head) and the picked field's controls on the right, in three blocks — what it is, the kind's own, the checks:

- its **Label**, its **Kind** from the list (below), its **Key** (made from the label until saved, then changed only by **Rename**, which carries every entry along), a line of **Help** under the control in the drawer, a **Default** for a new entry;
- **Required**, **Unique** (no two entries may share the value; the text kinds), **In the grid** (a column on the entries' grid);
- **Shown when** — **+ Add a condition** gives one row: another field, _is_ / _is not_ / _is empty_ / _is not empty_, and a value of that field's kind. A field whose condition does not hold is hidden in the drawer and nothing about it is checked;
- **Rules** — rows, each a rule picked from the list the kind takes and its parameters as controls (a number, two numbers, a list of values, a pattern, a date, a text): _At least_, _At most_, _Between_, _Exactly_, _One of_, _Not one of_, _Matches a pattern_, _Letters only_, _Letters and digits_, _Letters, digits, dashes_, _Numeric_, _Whole number_, _Digits_, _Web address_, _Email address_, _A date_, _After_, _Before_, _Starts with_, _Ends with_. They are Laravel's validation rules, run by the same port in the drawer and in the build;
- the kind's own: a select's **Options** (a label and a value each), a reference's **Model** and _One_ / _Several_, a list's **Rows of**, a group's **Fields in the group**.

**The kinds**, in four groups. _Text_: Text (one line), Long text, Markdown (the editor), Number, Yes / no, Date, Date & time, Web address, Email. _Choices_: Select (one of the options), Multi-select, Tags (free words), Reference (an entry of another model, one or several, picked by title). _Media_: Image, File — uploaded to the [library](/content/docs/running-a-site/content/media) or chosen from it, the field holding the address. _Structure_: Group (named sub-fields) and List (rows of one kind, or of a group). A group's sub-field and a list's row are of the text, choice or media kinds — one level of structure, never two. A sub-field may be **shown only while the row says so**, the same condition a field of the model itself takes — so a row that asks which kind of thing it is can then ask only what that kind needs, rather than showing every question and letting most of them go unanswered.

**Options** is what the model says about its entries: the **Title field** (what names an entry on the grid, the pages and in the head); the **Slug** — the file's name and the address — made from the title, or from another text field, on New; **Singleton** (one entry, edited inline, as the site's settings are); a **Body** (markdown under the fields, in the editor, with a label of your own — _Biography_); **Access** (who may open an entry's page: guest, signed in, paid, member — leave every chip off for everyone); **Order** (a field and a direction: the index, the JSON and the section follow it).

**Delivery** is four switches: **Data** (always on — the collection in the build, for the site's own code and sections), **Pages**, **JSON**, **Section**; the address each makes is shown under it.

**Save** writes the model. A field renamed is renamed in every entry on save. A kind or a rule changed under entries is checked first: the bar says _3 entries would no longer pass_ and names them, with **Save anyway** and **Keep editing** — so the build never refuses files you were not told about. A model with entries cannot be deleted; remove them first.

## The entries

Every published model is a row of its own under Content, by its name. Its entries are the collections' grid — the title first, then the fields marked _In the grid_, Published, sortable and filterable — and a drawer drawn from the model's fields in the model's order, the body under them when the model has one. **New** opens a blank entry with the model's defaults; the **Slug** field is made from the title (or the field the model names) and can be changed until the first save; after that **Rename** in the drawer's head moves the file and its address. A singleton model has no grid: it opens on its one entry.

Each field is its control — a date picker, a switch, the markdown editor, a select of the referenced model's entries by title, an uploader that puts the file in the library under the model's folder, and _Choose from the library_ beside it, rows to add, drag and remove for a list. A field that fails a rule says so under itself as you leave it, in the same words the build would use; a save with a fault is refused.

The file is `content/models/<key>/<slug>.md`: the fields as frontmatter in their own shapes (a number as a number, a list as a list, a group as a mapping, a reference as the other entry's slug, an upload as its address, `/uploads/<model>/<name>`), `published: false` when it is off, the body below. A file written by hand works the same way, and the build refuses one that fails its model — naming the file, the field and the fault — before the site can see it.

## Delivery

**Data** — the site's code reads the collection as `#content/models/<key>` (the published entries, in the model's order; a singleton as one object). A landing section or a component of the site's own can draw whatever it likes from it.

**Pages** — a plain index at `/c/<key>` (the model's name, every entry by its title with its first long text or markdown field as a summary and its date if it has one) and a page per entry at `/c/<key>/<slug>` (the title; every field with a value, in order, with its label — an image shown, markdown and the body rendered, a reference linked to its page when its model has pages, a list as rows, a group as its sub-fields; _Back to Teachers_), in the site's design, prerendered, in the sitemap, gated by the model's access as a book is. An unpublished entry has no page and no row.

**JSON** — `/data/models/<key>.json`, built static: the model's key, name and fields, and the published entries in order with every field, the body as markdown.

**Section** — an **Entries** section in the page builder: the model (from those with the section on), cards or a list, how many (0 for all), an eyebrow, heading and lead of the page's own; each entry links to its page when the model has pages, and _All Teachers →_ under a limited list.

## What the site writes about

Every piece of content carries **tags** — what it is about — and they come from one list the site
keeps, edited under **Tags** like any other record. A writer picks from that list rather than
typing, which is the whole point: typed freely, `Getting Started` and `getting started` are two tags
that look like one, and nothing downstream can tell them apart.

The list is a **declaration**, so it lives under `content/` — a file in a checkout, a row of the
content table where the content lives in rows, read and written the same way either side. It is
never a table of its own, and that is what lets an editor add a tag on a deployment with no
checkout: adding one is a publish, not a migration.

**"Let writers type a new tag"** is the switch, and it is held on the save rather than only on the
field. Off (the default) the field offers the list and nothing else, and a tag the list does not
hold is **refused** on save rather than quietly dropped — the field offered a closed list, so a
value outside it is a fault worth naming. On, a writer may type one and it **joins the list** rather
than living beside it, so the list stays the whole truth about what tags exist and a typo is
something you can find here and correct. Turning the switch back off keeps every tag already in the
list; only the typing of new ones stops.

Tags are matched by their words, not their capitals: `Shadow Work` and `shadow work` are the same
tag however either was typed.

They are also what the site recommends from.

## The words

Under **Models** the kit's own kinds and the site's — articles, books, forms, the tests — are listed too, marked _core_: opening one shows its fields as the drawer draws them, read-only, since those are declared in code and not built here.

The kit's words — the builder's, the kinds' and rules' names, the drawer's messages and its footer's buttons (Save · Create · Delete · Cancel, and in cloud mode Save draft · Publish with its confirm and the _Draft_ mark — every collection's drawer reads them here, not only a model's), the pages' _Nothing here yet._, _All {name}_, _Back to {name}_ — are the `models` strings scope, the theme's defaults a site overrides under **Settings → UI strings**. The model's own words — its name, its labels and help, a select's options — are the model file's, and never a string file's. The same scope carries the words of the shapes editor every product wears — including what a supplier's catalogue says when it has dropped a value ([The store](/content/docs/running-a-site/selling/store)).
