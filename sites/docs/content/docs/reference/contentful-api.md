---
title: The content API reference
description: Every route, argument, operator, field, header and error of the Contentful-compatible content API a site serves, the Management API's writes and webhooks included — the reference; the guide is under Building a site.
order: 85
sources:
  [
    packages/kit/supabase/functions/content/index.ts,
    packages/kit/supabase/functions/images/index.ts,
    packages/kit/supabase/functions/_shared/api/context.js,
    packages/kit/supabase/functions/_shared/api/entry.js,
    packages/kit/supabase/functions/_shared/api/errors.js,
    packages/kit/supabase/functions/_shared/api/flags.ts,
    packages/kit/supabase/functions/_shared/api/graphql.js,
    packages/kit/supabase/functions/_shared/api/ids.js,
    packages/kit/supabase/functions/_shared/api/image-size.js,
    packages/kit/supabase/functions/_shared/api/keys.ts,
    packages/kit/supabase/functions/_shared/api/manage.ts,
    packages/kit/supabase/functions/_shared/api/management.js,
    packages/kit/supabase/functions/_shared/api/openapi.js,
    packages/kit/supabase/functions/_shared/api/pipe.ts,
    packages/kit/supabase/functions/_shared/api/query.js,
    packages/kit/supabase/functions/_shared/api/records.js,
    packages/kit/supabase/functions/_shared/api/richtext-to-markdown.js,
    packages/kit/supabase/functions/_shared/api/richtext.js,
    packages/kit/supabase/functions/_shared/api/types.js,
    packages/kit/supabase/functions/_shared/content-index.ts,
    packages/kit/build/content-api.test.mjs,
    packages/kit/build/management.test.mjs,
    packages/kit/supabase/schemas/85-api.sql,
  ]
reviewed: 2026-10-11
---

The guide is [The content API, Contentful's](/content/docs/building-a-site/contentful-api). This page says exactly what is there.

A subscription carries a **source**: one somebody made through this API is `hand` and is theirs, and one a deployment ships declared in `platformkit.config.js` is `file` and is the projection's to replace — see [Declarations and state](/content/docs/building-a-site/declarations-and-state).

## Base, keys, headers

|                      |                                                                                                                                                                                                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delivery and Preview | `https://<domain>/api/content/spaces/<space>/environments/master` (`/environments/master` may be left out); the function's own address `https://<ref>.supabase.co/functions/v1/content/spaces/…` answers too                                                                                                                  |
| GraphQL              | `https://<domain>/api/content/content/v1/spaces/<space>/environments/master` — POST `{ query, variables, operationName }`, or GET `?query=`                                                                                                                                                                                   |
| Images               | `https://<domain>/api/media/<space>/<asset id>/<hash>/<file>?…` — the address every asset's `fields.file.url` names                                                                                                                                                                                                           |
| the key              | `Authorization: Bearer <key>` or `?access_token=<key>`; a delivery key, a preview key, or none where Delivery is public; a management key for a write, and for every read in the Management shapes                                                                                                                            |
| methods              | `GET`, `HEAD`, `OPTIONS`; GraphQL `POST`; the Management API's `POST`, `PUT`, `DELETE` under a management key (a lesser key is `AccessDenied`, 403; git mode `BadRequest`, 405)                                                                                                                                               |
| headers              | `Content-Type: application/vnd.contentful.delivery.v1+json`; `ETag` and `If-None-Match` → 304; `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`; `X-Contentful-Request-Id`; `X-Contentful-RateLimit-Hour-Limit` (36 000), `-Hour-Remaining`, `-Second-Limit` (78), `-Second-Remaining`, `-Reset` |
| CORS                 | open (`*`)                                                                                                                                                                                                                                                                                                                    |

## Routes

| Route                                                        | Answers                                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `/api/content/spaces/<space>`                                | `{ sys: { type: 'Space', id }, name, locales }`                                                                  |
| `/api/content/spaces/<space>/environments/master`            | `{ sys: { type: 'Environment', id: 'master' }, name }`                                                           |
| `…/entries`                                                  | a collection of entries; every argument below                                                                    |
| `…/entries/<id>`                                             | one entry (`select` honoured)                                                                                    |
| `…/assets`, `…/assets/<id>`                                  | the media library's files as assets                                                                              |
| `…/content_types`, `…/content_types/<id>`                    | the content types, derived from the models                                                                       |
| `…/locales`                                                  | the site's languages: `{ sys, code, name, default, fallbackCode, optional }`                                     |
| `…/sync`                                                     | `?initial=true`, then `?sync_token=`: `items`, `nextPageUrl` while paging, `nextSyncUrl` at the end              |
| `/api/content/content/v1/spaces/<space>/environments/master` | GraphQL                                                                                                          |
| `/openapi.json`, `/api/content/content/v1/openapi.json`      | the OpenAPI 3.1 document of the whole surface (no key; `application/json`); shown at the site's `/api` on Scalar |
| `/sweep-uploads` (POST, the service key)                     | the uploads' daily sweep, asked by pg_cron (`sweep_uploads`); `?older_than_ms=` for a run by hand                |

A collection is `{ sys: { type: 'Array' }, total, skip, limit, items, includes?, errors? }`. Another space id or environment answers `NotFound` with `details: { type: 'Space' | 'Environment', id }`.

## The Management API (cloud mode)

The same routes under a management key, `Content-Type: application/vnd.contentful.management.v1+json`. A read answers the Management shape: `fields` by locale (`{ "en-US": … }`), `sys.version` (the row's revision × 2, + 1 while a draft is pending), `sys.publishedVersion`, `publishedAt`, `firstPublishedAt`, `publishedCounter`, `createdBy` and `updatedBy` (User links: the key's maker, or the person in the admin). In git mode every writing method answers `BadRequest` (405) with the reason. On save, the content pipe omits empty arrays from the file, so those fields are absent from the returned draft and subsequent reads.

| Method and route                                                                                     | Does                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST …/entries` (`X-Contentful-Content-Type: <type>`)                                               | creates an entry, unpublished, id `<type>.<path>` from the record's `slug` field, else its title slugified (400 with neither; 409 `VersionMismatch` when the id exists) → 201 |
| `PUT …/entries/<id>` (`X-Contentful-Version`)                                                        | creates at that id (201), or replaces the typed fields whole (200) — a field left out is dropped, the admin's own fields kept; a stale version is 409                         |
| `PUT …/entries/<id>/published`                                                                       | publishes the draft: live at once, pushed to the repository; `Entry.publish` delivered                                                                                        |
| `DELETE …/entries/<id>/published`                                                                    | unpublishes: the record stays (`published: false`), Preview keeps it, Delivery loses it; `Entry.unpublish`                                                                    |
| `DELETE …/entries/<id>`                                                                              | removes the record and publishes the removal (a `DeletedEntry` to a sync token from before) → 204                                                                             |
| `GET …/entries`, `…/entries/<id>`, `…/assets`, `…/assets/<id>`                                       | the Management shapes (`?content_type`, `skip`, `limit` on the list)                                                                                                          |
| `POST /api/content/spaces/<space>/uploads`                                                           | the body is the file's bytes → an `Upload` (`sys.id`, `expiresAt` a day on)                                                                                                   |
| `GET`, `DELETE /api/content/spaces/<space>/uploads/<id>`                                             | the upload, or its removal                                                                                                                                                    |
| `POST …/assets`, `PUT …/assets/<id>`                                                                 | an asset from `fields.file[locale].uploadFrom` (an Upload link) or `.upload` (a url), with `title` and `description`; pending until processed → 201                           |
| `PUT …/assets/<id>/files/<locale>/process`                                                           | takes the bytes into the library at `content/uploads/api/<id>/<fileName>` → 204; the asset then carries `url` and `details`; `Asset.publish`                                  |
| `PUT …/assets/<id>/published`                                                                        | a library file is published by being there: answers the asset                                                                                                                 |
| `DELETE …/assets/<id>/published`                                                                     | 400: delete the asset instead                                                                                                                                                 |
| `DELETE …/assets/<id>`                                                                               | removes the file (204); 409 while a record names it, `details.used` saying which                                                                                              |
| `GET`, `POST /spaces/<space>/webhook_definitions`; `GET`, `PUT`, `DELETE …/webhook_definitions/<id>` | the subscriptions: `{ name, url, topics, headers: [{ key, value, secret? }], active }` (422 with a bad url or topic); PUT replaces whole                                      |
| `PUT …/content_types/…`, `…/locales`                                                                 | 405: a content type is a model of the builder, the locales the config's                                                                                                       |

**A write's fields**: a plain field its value; a RichText field as a document (`richtext-to-markdown.js` turns it back) or as its `<field>Markdown` twin, the twin winning; an Asset link `{ sys: { type: 'Link', linkType: 'Asset', id } }` a library file (422 `notResolvable` when there is none); an Entry link `{ … linkType: 'Entry', id }` another entry's id. `ValidationFailed` (422) carries `details.errors[]` with `name` (`unknown`, `notResolvable`, `invalid`), `path` (`['fields', <field>]`) and `details`.

**Webhook deliveries**: `POST <url>` with `X-Contentful-Topic: ContentManagement.<Entry|Asset>.<create|save|publish|unpublish|delete>`, `X-Contentful-Webhook-Name`, the definition's headers, and the entry or asset in the Management shape (a `DeletedEntry` / `DeletedAsset` for a delete); `topics` match by `<Type>.<event>`, `<Type>.*` and `*.*`. From the row store's own events, so the admin's publish delivers too. `content_webhooks` holds `last_at` and `last_error`; Settings → API lists it. Uploads never processed, and assets made but never processed, go with the daily sweep (`sweep_uploads`, `50 4 * * *`).

## An entry

| Field                                             | Value                                                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `sys.id`                                          | `<contentType>.<path with / as .>` — `article.read-it-aloud`, `doc.store.orders-and-files`; unique across the space, stable across builds      |
| `sys.type`                                        | `Entry`                                                                                                                                        |
| `sys.space`, `sys.environment`, `sys.contentType` | Links, as Contentful writes them                                                                                                               |
| `sys.createdAt`                                   | the record's `date`, else the first time it was checked in (git mode) or its publish (cloud mode)                                              |
| `sys.updatedAt`                                   | the last time it was checked in, or the publish; the draft's time on the Preview API                                                           |
| `sys.revision`                                    | how many times it was checked in (git mode); 1 in cloud mode                                                                                   |
| `sys.locale`                                      | the locale answered (the default, or `locale=`)                                                                                                |
| `fields`                                          | exactly the content type's fields, in its order; a field the record leaves empty is absent; with `locale=*` every value is `{ <code>: value }` |

Field values by type: `Symbol` / `Text` a string; `Integer` / `Number` a number; `Boolean`; `Date` an ISO 8601 string; `Object` the frontmatter's value as it is; `Array` of `Symbol` a list; `Link` `{ sys: { type: 'Link', linkType: 'Entry' | 'Asset', id } }`; `Array` of Links a list of them; `RichText` Contentful's document (`document` → `heading-1…6`, `paragraph`, `unordered-list`, `ordered-list`, `list-item`, `blockquote`, `hr`, `table`, `table-row`, `table-header-cell`, `table-cell`, `hyperlink`, `embedded-asset-block`, `text` with the marks `bold`, `italic`, `code`); a markdown field's `<field>Markdown` twin the markdown itself; a body `body` and `bodyMarkdown`. A gated entry (`canAccess` beyond guest) omits its body fields unless the key is allowed gated content.

## A content type

`{ sys: { id, type: 'ContentType', space, environment, createdAt, updatedAt, revision }, name, description, displayField, fields: [{ id, name, type, localized, required, disabled, omitted, validations, linkType?, items? }] }`. Types: `Symbol`, `Text`, `RichText`, `Integer`, `Number`, `Date`, `Boolean`, `Object`, `Link` (`linkType` `Entry` with `validations: [{ linkContentType: [<type id>] }]`, or `Asset`), `Array` (`items` a `Symbol` with an `in` validation of fixed choices, an `Object`, or a `Link`). A select's choices are `validations: [{ in: [...] }]`. Ids are the model's singular in camelCase: the kit's `article`, `book`, `wiki`, `doc`, `page`, `companion`, `product`, `collection`, `ad`, `experiment`, `session`, `site`, `storefront`; a model of the site's own by its singular under a `model` namespace (`models/events` → `modelEvent`), so it can never land on a stock collection's id.

## An asset

`{ sys: { id (a hash of the address), type: 'Asset', space, environment, createdAt, updatedAt, revision, locale }, fields: { title (the file name without its extension), description (''), file: { url, details: { size, image?: { width, height } }, fileName, contentType } } }`. `url` is protocol-relative on the site's images door — `//<domain>/api/media/<space>/<id>/<hash>/<file>` — or, for a picture a record names elsewhere, that address itself.

## Collection arguments

| Argument                                      | Meaning                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content_type`                                | one type's entries; required to filter or order on `fields.*` (else `BadQuery`)                                                                                                                                                                                           |
| `select`                                      | `sys.id,fields.title,…` — two levels at most; `sys` always comes whole                                                                                                                                                                                                    |
| `include`                                     | 0–10 (1 by default): the depth of `includes.Entry` and `includes.Asset`; the page's own items are never in `includes`; a link to nothing published is listed under `errors` as `{ sys: { id: 'notResolvable', type: 'error' }, details: { type: 'Link', linkType, id } }` |
| `locale`                                      | a code of the site's, or `*` for every locale; another `BadQuery`                                                                                                                                                                                                         |
| `order`                                       | `sys.createdAt`, `sys.updatedAt`, `sys.id`, `sys.revision`, `fields.<f>` — a list, `-` for descending; `-sys.createdAt` by default                                                                                                                                        |
| `limit`                                       | 1–1000 (100 by default)                                                                                                                                                                                                                                                   |
| `skip`                                        | from 0                                                                                                                                                                                                                                                                    |
| `query`                                       | full text over every field and the body                                                                                                                                                                                                                                   |
| `sys.id`, `sys.id[in]`, `sys.createdAt[gte]`… | on `sys`                                                                                                                                                                                                                                                                  |
| `fields.<f>`                                  | equality; `[ne]`, `[in]`, `[nin]`, `[exists]`, `[lt]`, `[lte]`, `[gt]`, `[gte]`, `[match]`, `[all]`; `fields.<link>.sys.id` on a link; `[near]` and `[within]` answer `InvalidQuery` (no Location fields)                                                                 |
| `links_to_entry`, `links_to_asset`            | the entries linking to that id                                                                                                                                                                                                                                            |
| `mimetype_group`                              | assets: `image`, `audio`, `video`, `pdfdocument`, `plaintext`, `richtext`, `presentation`, `spreadsheet`, `code`, `archive`, `attachment`                                                                                                                                 |

Assets take `select`, `order` (`sys.createdAt`, `fields.title`), `limit`, `skip`, `query`, `sys.id[in]`, `fields.title`, `fields.file.fileName`, `fields.file.contentType`, `mimetype_group`.

## Sync

`?initial=true` — every published entry and asset in pages of 100 (`nextPageUrl`), then `nextSyncUrl`; `type` (`all`, `Entry`, `Asset`, `Deletion`, `DeletedEntry`, `DeletedAsset`) and `content_type` narrow it. `?sync_token=<token>` — the entries and assets changed since, and `DeletedEntry` / `DeletedAsset` rows (`sys.deletedAt`) for what is gone; a fresh `nextSyncUrl`. Items carry every locale. A token that is not one of ours is `BadQuery`.

## GraphQL

Generated from the content types. Query fields: `<type>(id!, preview, locale)`, `<type>Collection(skip, limit, preview, locale, where: <Type>Filter, order: [<Type>Order])`, `asset(id!)`, `assetCollection(where: AssetFilter, order: [AssetOrder])`, `entryCollection(where: EntryFilter)`. A type has `sys { id spaceId environmentId publishedAt firstPublishedAt publishedVersion locale }`, `contentfulMetadata { tags concepts }`, `linkedFrom { entryCollection <type>Collection… }`, and its fields — `String`, `Int`, `Float`, `Boolean`, `DateTime`, `JSON`, a linked type, `Asset`, `<Type><Field>Collection` for a list of links, `<Type><Field> { json links { entries { block inline hyperlink } assets { block hyperlink } } }` for Rich Text. Filters: `<f>`, `<f>_not`, `<f>_in`, `<f>_not_in`, `<f>_exists`, `<f>_contains`, `<f>_not_contains`, `<f>_gt/_gte/_lt/_lte`, `<list>_contains_all/_some/_none`, `<link>: { … }` (a nested filter), `sys: SysFilter`, `AND`, `OR`. Orders: `<f>_ASC/_DESC` for every sortable field, `sys_id_*`, `sys_publishedAt_*`, `sys_firstPublishedAt_*`, `sys_publishedVersion_*`. `Asset.url(transform: { width, height, quality, cornerRadius, resizeStrategy, resizeFocus, backgroundColor, format })` writes the Images API's parameters. `preview: true` needs a preview key (`ACCESS_DENIED`, 403); a query over 11 000 in Contentful's complexity is `TOO_COMPLEX_QUERY`; a malformed one `INVALID_QUERY` — each under `errors[].extensions.contentful.code`.

## Images

`w`, `h` (1–4000), `fit` (`pad`, `fill`, `scale`, `crop`, `thumb`; none: fit within), `f` (`center`, `top`, `right`, `left`, `bottom`, `top_right`, `top_left`, `bottom_right`, `bottom_left`; `face`, `faces` → `center`), `fm` (`jpg`, `png`, `webp`, `gif`; `avif` → `webp`), `q` (1–100), `r` (a radius, or `max`), `bg` (`rgb:rrggbb`). `Cache-Control: public, max-age=31536000, immutable`, `ETag`; out of range `BadQuery` (400); an unknown asset `NotFound`.

## Errors

`{ sys: { type: 'Error', id }, message, details?, requestId }`: `NotFound` (404: a space, environment, entry, asset, content type or route), `BadQuery` (400: an argument out of range, a field filter with no `content_type`, an unknown locale, a bad sync token), `InvalidQuery` (400: an unknown content type, `details.errors[0].name = unknownContentType`; an unsupported operator), `AccessTokenInvalid` (401: no key where Delivery is private, a revoked key), `AccessDenied` (403: a write, or a Management read, under a key that is not a management key), `VersionMismatch` (409: a stale `X-Contentful-Version`, an entry already at an id, an asset in use), `ValidationFailed` (422: a field, a link or a value refused, `details.errors` naming each), `RateLimitExceeded` (429: `X-Contentful-RateLimit-Reset` says when), `BadRequest` (405: a write).

## The OpenAPI document

`openapi: 3.1.0`; `info.title` `<site name> API`, `version` `1`; `servers` the site's public address first (the host rewrites `/spaces`, `/content/v1`, `/images` and `/v1` to the functions), then the content function's own; `tags` `Content Delivery`, `Content Management`, `Content Sync`, `Content GraphQL`, `Content Images`, `Analytics Events`, `Analytics Capture`, and, with the forms module on, `Forms`, `Responses`, `Webhooks`, `Insights`, with the sessions module on `Event Types`, `Slots`, `Bookings`, `Schedules`, `Scheduling Webhooks`, with the store module on `Storefront`, with the support module on `Client`, `Conversations`, `Contacts`, `Support Webhooks`, gathered by `x-tagGroups` into _Content API_, _Forms API_, _Scheduling API_, _Store API_, _Support API_ and _Analytics API_ (each tag's description says what it is a drop-in for — the sidebar carries names only); `paths` every route above under its tag — the space, entries and one entry, assets and one asset, content types and one, locales, sync; GraphQL POST and GET; the image route; `/api/events` (the site's own batch), `/api/events/e/`, `/api/events/batch/`, `/api/events/flags/`, `/api/events/array/{token}/config.js` — each with its parameters (`content_type` an enum of the type ids), its responses and Contentful's errors; `components.securitySchemes.key` the bearer key; `components.schemas` `Link`, `Sys`, `RichTextDocument`, `Asset`, `ContentType`, `ContentTypeField`, `Locale`, `Error`, `Entry` (one of every type), `EntryCollection`, `AssetCollection`, `SyncCollection`, `AnalyticsEvent`, `AnalyticsBatch`, `PostHogEvent`, `PostHogBatch`, `FlagsResponse`, and one schema per content type under its id in PascalCase (`Article`, `Book`, a site model's namespaced singular such as `ModelEvent`) with `fields` typed from the content type. `_shared/api/openapi.js` is the generator; the page is `ApiReferencePage.vue` at `/api` (`ROUTES.api`, behind the `api` module).

## Keys

`api_keys` in the database: `name`, `kind` (`delivery` | `preview` | `management` | `forms` | `scheduling` | `storefront` | `support`), `gated`, `prefix`, `hash` (sha256 of the key; the key itself is never stored), `created_by`, `created_at`, `last_used_at`, `revoked_at` — administrators read and write under RLS; the functions look a key up by its hash with the service role. A key is `pk_<kind>_<32 base62 characters>`. `api.public` (default true) and `api.space` (default the site's slug) in `platformkit.config.js`; the module switch is `api`.
