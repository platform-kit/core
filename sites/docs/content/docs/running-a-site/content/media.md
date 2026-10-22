---
title: Media
description: The library — every picture and file the site uses in one place; addresses instead of files beside records; the picker on every file field; the same library in git mode and cloud mode
order: 14
sources:
  [
    packages/kit/theme/src/components/MediaPage.vue,
    packages/kit/theme/src/components/admin/MediaPicker.vue,
    packages/kit/theme/src/lib/admin/media-driver.js,
    packages/kit/theme/src/lib/admin/media-pick.js,
    packages/kit/theme/src/content/ui/media.md,
    packages/kit/build/assets.mjs,
    packages/kit/build/runtime-paths.mjs,
    packages/kit/build/migrate-assets.mjs,
    packages/kit/theme/src/components/admin/media,
    packages/kit/build/admin-pipe.mjs,
    packages/kit/build/images,
    packages/kit/theme/src/components/admin/ImageSource.vue,
  ]
reviewed: 2026-10-21
---

## One library

**Content → Media** is the site's file manager: every picture and file the site uses, in one place, to browse, upload, arrange and address. It has two roots and no others:

| Root           | Where the files are | How a file is addressed |
| -------------- | ------------------- | ----------------------- |
| **Uploads**    | `content/uploads/`  | `/uploads/<path>`       |
| **Site files** | `public/`           | `/<path>`               |

Content → Media is an editor's as much as an administrator's (`may_edit_content()`). Uploads is where the admin puts what you give it — a book's cover lands in `content/uploads/books/`, an article's hero in `content/uploads/articles/`, a body image in `content/uploads/` — and Site files is the checkout's `public/` directory, the static files a developer put there. Nothing else is reachable from the manager: never a private bucket, never a directory beside a record.

The manager is VueFinder underneath, wearing the admin's own chrome and colours by day and by night. Its head holds the two roots as a switch, **Search** (a search of the folder, with _Include subfolders_), **Folders** (a tree down the side, with pinned folders) and grid · list; under it a toolbar — **New folder**, **Upload**, and once something is chosen its count with **Rename** (one file or folder), **Move to…**, **Copy to…**, **Download** (one file), **Delete** and a clear — then the breadcrumb path with Up one level and Refresh beside it. A double-click opens a folder or previews a file (a picture large, a text file read); a right-click gives the same actions as a menu; files dropped anywhere on the manager are uploaded (Uppy, with each file's progress and a retry); tiles dragged onto a folder move there. Every modal — the new folder, the rename, the move (with _Create a copy instead of moving_), the delete's confirm, the upload's queue, the search — is the admin's paper with its buttons. Under the manager, the chosen file's name and **address** with **Copy the address** — the one thing to carry to a field that takes a web address by hand. What it does not offer, because the site's store does not serve it: archives, a text editor, a new empty file.

## Every file is referenced by address

A record's file field — a book's cover or share image, an article's hero, a landing section's picture, a model's image or file field, a form's picture choice, a chat prompt's picture — holds an **address**: `/uploads/…` for a file in Uploads, `/…` for one in Site files, or a web address (`https://…`) for a picture hosted elsewhere. No file is kept beside a record's markdown any more: the build resolves an address to its file wherever it needs the bytes — the shelves' sized covers, the paperback's front, the edition's hash, the share cards — through one resolver (`build/assets.mjs`), and the browser is served the address as it is.

When a web address is not already present in the checkout, the resolver fetches it once and caches it by address under `node_modules/.cache/platformkit/assets/`. It never writes the fetched file beside the record.

A site that still has pictures beside its records (`cover: ./the-kybalion.png`) is moved in one run: `node packages/kit/build/migrate-assets.mjs` (`--dry` to see) puts every such picture under `content/uploads/<collection>/` and rewrites its field to the address, reporting each; a second run moves nothing. Until it is run the build still finds a picture beside its record, and says so as the old way.

## A file in use is kept

A file a record still points at — a book's cover, an article's hero, a landing section's picture, a model's image, an email design's picture — cannot be deleted, renamed or moved: any of the three would leave that record pointing at nothing. The manager checks before it acts, by the file's address in every content record (every markdown under `content/`, drafts included in cloud mode, and the email designs). Choose the file and the status bar says **Used by 1 record** (hover for the titles); Rename, Move to… and Delete are greyed for it. A delete tried from the context menu comes back as _the-kybalion.png is used by The Kybalion and was not deleted._ — and a folder holding a used file is kept whole. To remove the file, change the record first. A picture named in the site's own code (`src/`) is a developer's, and the manager cannot see it.

## The picker: Choose from the library

Every file field of the admin has two buttons: **Upload** (the file goes into Uploads under the collection's folder, and the field takes its address) and **Choose from the library**, which opens the same manager as a picker — one file at a time, pictures only where the field wants a picture (a form's picture choice, a section's picture; a model's _File_ field takes anything), **Use this file** or Cancel, a double-click on a file choosing it. The field takes the chosen file's address. The body editor's image button offers the same two ways, and inserts the picture by its address.

The picker is the manager whole: you can upload into it, make a folder, rename, and then choose — so _Choose from the library_ is also the way to put a file exactly where you want it before a field takes it.

## Where else a picture can come from

A field that wants a **picture** may offer more than the library. Whatever the site has keys for shows beside it as a tab of the same window — **Library**, then each source by name — and a source the site has no key for is simply not there: there is no greyed-out tab, no "configure this first", nothing to press that then fails. A site that has set nothing sees exactly the library it always saw, with no tabs at all.

**Unsplash** is the first of them. Set `UNSPLASH_ACCESS_KEY` (a free account at [unsplash.com/developers](https://unsplash.com/developers) gives you one) and every picture field gains an Unsplash tab: type what you are after, press Search, and the photographs come back in a grid with the photographer's name under each, linked. Click one and it is **copied into your library** — under the same folder an upload from that field would have gone to — and the field takes its ordinary `/uploads/…` address like any other file. Nothing hotlinks: the site keeps its pictures whatever becomes of the account they came from, the shelves size them, the paperback prints them, the editions hash them, and every other rule on this page goes on working because there is nothing special about a picture that arrived this way. The same photograph chosen twice is the same file.

The key never reaches a browser. Every search and every fetch is made by the admin's own server, which is why the key is an environment variable and not a setting an editor can type.

**More sources are expected** — generated pictures among them — and they arrive as tabs in this same window with nothing to learn: the search box, the grid, the click, the library. For a developer: a source is one file under `packages/kit/build/images/` and its name in `SOURCES`, answering `configured()`, `search()` and `take()`; see [the admin as a host](/content/docs/running-a-site/the-admin).

## Both modes

In git mode the library is the checkout: `content/uploads` and `public` on disk, and the addresses are served by the dev server and the build. In [cloud mode](/content/docs/running-a-site/settings/cloud-mode) the library is the `content-assets` bucket under the same paths — a folder is a name, an empty folder held by a placeholder you never see — and a file uploaded there is addressed by the bucket's own public url, which a field holds as it holds any web address; the deploy's export pulls the bucket's files into the checkout so the build resolves them like the rest. Either way the manager, the picker and the pipe are the same code over one store, and the entries read the same but for the address.

The words the admin adds — the roots, the bar, the toolbar, the fields' buttons — are the `media` scope's (see [Site settings and strings](/content/docs/running-a-site/settings/site-settings-and-strings)); the lines inside VueFinder's own modals and menu keep its English.
