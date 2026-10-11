# media-library Specification

## Purpose
The site's files as one library: every file referenced by address and resolved by the build wherever it needs the bytes; a page to browse, upload, arrange and address them; the picker every file field opens — over the checkout in git mode and the bucket in cloud mode, through the same pipe.

## Requirements

### Requirement: Every file is referenced by address

A record's file field — a cover, a share image, a section's picture, a model's image — SHALL hold an **address**: `/uploads/<path>` for a file under `content/uploads`, `/<path>` for one under `public`, or a bucket url for one uploaded in cloud mode; never a path relative to the record. No file SHALL be kept beside a record's markdown. `build/assets.mjs` SHALL resolve an address to a file for the build — `/uploads/…` → `content/uploads/…`, `/…` → `public/…`, a `content-assets` url → the file under the same path (the export pulls it; fetched once into `.platformkit/assets/` when it is not there), and a relative `./x` beside a record (a hand-written file) resolved as before and reported as the old way — and velite's cover sizing, the print's paperback picture and edition hash, and the share cards SHALL take their bytes through it. The migration (`build/migrate-assets.mjs`) SHALL move every picture beside a record into `content/uploads/<collection>/` and rewrite its field, once, reporting what moved.

#### Scenario: a cover by address, sized as before

- **WHEN** a book says `cover: /uploads/books/example-cover.png` and the site is built
- **THEN** the shelves show the sized webp under `/static`, the paperback's picture is that file, the edition's hash includes its bytes, and the share card draws it — as it did when the file sat beside the book

Verified by: `entry.test.mjs` and the build on a site after the migration; `print.mjs --dry` reporting the same editions; a kit test of the resolver (the three address kinds and the old way)

#### Scenario: a cover uploaded in cloud mode reaches the build

- **WHEN** a book's cover is chosen or uploaded on a cloud-mode site (a bucket url) and the deploy runs
- **THEN** the export pulls the file to `content/uploads/…`, the resolver finds it, and the build sizes it like any cover

Verified by: the export test with a bucket asset; the resolver test with a bucket url

#### Scenario: the migration

- **WHEN** `node build/migrate-assets.mjs` runs on a site with pictures beside its records
- **THEN** each is moved to `content/uploads/<collection>/<name>`, its field rewritten to `/uploads/<collection>/<name>`, the report lists them, and a second run moves nothing

Verified by: the migration run on a site and the demo (their pictures moved, committed); a kit test over a scratch site

### Requirement: The Media page is a file manager over the site's file roots

Content → **Media** (`/admin/media`) SHALL be VueFinder (MIT, Vue 3, loaded with the admin's chunk and never with the site's) over two roots: **Uploads** (`content/uploads`, served at `/uploads/…`) and **Site files** (`public`, served at `/…`); no other directory, never a private bucket. It SHALL offer browse (grid and list), preview, upload (Uppy: drag and drop, several at once), new folder, rename, move, copy, delete and search, and every file's served address to copy; it SHALL NOT offer archives, unarchiving, a text editor or a new empty file. **Its chrome SHALL be the theme's own through VueFinder's slots** — the roots as the admin's segmented control and the search with *Include subfolders* and grid · list in the menubar's place (`menubar-start`, `menubar-end`, `menu-items`), a toolbar of labelled `ui-btn` buttons on `useVueFinder()` (New folder, Upload, and on a selection its count, Rename, Move to…, Copy to…, Download, Delete, Clear — `toolbar-items`), Up one level and Refresh beside the breadcrumb (`breadcrumb-actions`), the chosen file's name and address with Copy the address in the status bar (`status-bar`), Lucide's glyphs for VueFinder's (`icon`) — and **its explorer, context menu and every modal SHALL be skinned to the admin's tokens** through VueFinder's `vuefinder__*` class hooks (a stylesheet of the theme's, loaded after VueFinder's): the tiles as paper cards on the hair with the accent ring when chosen, the rows in the admin's type, the modals — rename, delete, move, preview, search, Uppy's upload with its dashboard — on the admin's paper with `ui-btn` buttons, by day and by night, following the site's theme; VueFinder's own markup and stylesheet SHALL NOT be patched. **A file in use SHALL be shown and kept**: when a file is chosen the status bar SHALL say *Used by* with the count and name the records on hover, the toolbar's Rename, Move to… and Delete SHALL be disabled for it with the same words, and a refusal that comes back another way (the context menu, a folder holding a used file) SHALL be worded from the `media` scope in the toast, never a raw error. Every word the theme adds SHALL be the `media` scope's; VueFinder's remaining strings keep its English.

#### Scenario: a picture uploaded, renamed, moved and addressed

- **WHEN** an administrator drops a picture into Uploads, renames it, makes a folder and moves it there, and copies its address
- **THEN** the file is at `content/uploads/<folder>/<name>` (git mode: on disk; cloud mode: in the bucket under that path), the address copied is `/uploads/<folder>/<name>` (git) or the bucket's public url (cloud), and it shows on a page given that address

Verified by: Playwright on the demo in both modes, screenshots both themes; the store's asset-browse test

#### Scenario: the chrome is ours and the rest is skinned

- **WHEN** the Media page and the picker are opened in both themes, and every state is drawn — the tiles and the rows, a selection with the toolbar's actions, the context menu, the rename, delete and move modals, the preview, the search, Uppy's upload modal with a queue, the empty folder
- **THEN** no VueFinder menubar, toolbar button or glyph is on the page; every colour, face, radius and button on the explorer and the modals is the admin's; and the picker is the same in its modal

Verified by: screenshots of every state, both themes, on a site (git) and the demo (cloud)

#### Scenario: what the manager refuses

- **WHEN** a path outside the two roots, or a name with a slash or a dot-segment, is asked for
- **THEN** the pipe refuses it (400) and nothing is read or written

Verified by: the kit test of the pipe's `media` route

#### Scenario: a cover the manager will not delete

- **WHEN** an administrator chooses a book's cover in the library, and then tries Delete from the context menu
- **THEN** the status bar says *Used by 1 record* (the book's title on hover), the toolbar's Delete, Rename and Move to… are disabled, and the context menu's Delete comes back as *<name> is used by <title> and was not deleted.* with the file still there

Verified by: Playwright on a site — a book cover under Uploads → books; screenshots both themes

### Requirement: Every file field opens the library

Every field of the admin that takes a file — a record's cover and share images (the drawer's image widget), a content model's image field, a page section's picture, a form field's image, a chat prompt's picture, and the body editor's image button — SHALL offer **Choose from the library** beside Upload, opening the manager as a picker: one file, pictures only where the field wants a picture, Use this file or Cancel; the field SHALL take the chosen file's address. Upload SHALL put the file under `content/uploads/<collection>/` and hand the field its address the same way; the relative/absolute rule (`assets.ref`) SHALL be gone.

#### Scenario: a cover chosen from the library

- **WHEN** Choose from the library is pressed on a book's cover, a picture under Uploads chosen and Use this file pressed
- **THEN** the field holds `/uploads/<path>` (cloud mode: the bucket's url), shows it, the save writes it, and the shelf shows the cover on the next load

Verified by: Playwright on the demo in both modes, screenshots

#### Scenario: a section's picture chosen

- **WHEN** Choose from the library is pressed on a hero section's picture and a file under Site files chosen
- **THEN** the field holds its served address and the preview shows it

Verified by: Playwright on the demo, a screenshot

### Requirement: One library in both modes

The store SHALL carry the asset browse beside its asset calls — `assets.list(dir)` (entries with their kind, size, modified time and served address), `assets.mkdir`, `assets.rename`, `assets.move`, `assets.copy`, `assets.remove`, `assets.search` — the checkout's over the two directories on disk, the rows' over the `content-assets` bucket under the same paths (a folder a name; a folder moved, copied or removed with everything under it; an empty folder held by a placeholder object never listed). The pipe's `media` route SHALL answer the manager's driver from either store, and in cloud mode SHALL be the `admin` function's, behind the administrator's JWT. **A file in use SHALL NOT be removed, renamed or moved**: before any of the three the pipe SHALL look for the file's address — `/uploads/<path>`, `/<path>` for `public`, and the `content-assets` bucket's url for the same path — in every content record's text (every markdown file under `content/` but the library itself, and the emails' designs), through the store, so a draft's reference counts in cloud mode; a folder SHALL be checked for every file under it; a file any record names SHALL be refused (409) with the records that use it (their paths and titles) and nothing SHALL be written; `media usage { paths }` SHALL answer the same records for the manager to show.

#### Scenario: the same library either side

- **WHEN** the same files are put in a scratch checkout and in the bucket and listed, moved, copied, searched and removed through the store
- **THEN** both stores answer the same entries, paths and kinds, differing only in the served address; a path outside the roots is refused

Verified by: a kit test over the scratch directory and the local stack's bucket

#### Scenario: a file in use is refused

- **WHEN** a scratch site's book says `cover: /uploads/books/a.png` and a page's section says `image: /img/b.jpg`, and the store is asked to remove, rename or move `content/uploads/books/a.png`, `public/img/b.jpg`, or the folder `content/uploads/books`
- **THEN** each is refused with the book, or the page, named, the files are still there, and a file no record names goes through; in cloud mode a reference held only in a draft counts

Verified by: a kit test of `assetUsage` over a scratch site (`assets.test.mjs`) and of the pipe's refusal over both stores (`store.test.mjs`)

