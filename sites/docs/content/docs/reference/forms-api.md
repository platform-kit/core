---
title: The Forms API reference
description: Every route, argument, field, header and error of the Typeform-compatible Forms API a site serves — the reference; the guide is under Building a site.
order: 85.5
reviewed: 2026-10-21
sources:
  [
    packages/kit/supabase/functions/forms-api/index.ts,
    packages/kit/supabase/functions/_shared/api/typeform,
    packages/kit/supabase/functions/_shared/api/keys.ts,
    packages/kit/supabase/schemas/25-forms.sql,
    packages/kit/build/forms-api.test.mjs,
  ]
---

The guide is [The Forms API, Typeform's](/content/docs/building-a-site/forms-api). This page says exactly what is there.

A subscription carries a **source**: one somebody made through this API is `hand` and is theirs, and one a deployment ships declared in `platformkit.config.js` is `file` and is the projection's to replace — see [Declarations and state](/content/docs/building-a-site/declarations-and-state).

## Base, keys, headers

|         |                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| base    | `https://<domain>/api` (the `/v1/*` rewrite); the function's own address `https://<ref>.supabase.co/functions/api/…` answers too         |
| the key | `Authorization: Bearer <key>` or `?access_token=<key>`; a key of kind `forms` (Settings → API); never none — `api.public` does not apply |
| methods | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`; a write to a form in git mode answers `METHOD_NOT_ALLOWED` (405)                     |
| headers | `Content-Type: application/json`; the api module's rate-limit headers; `Retry-After` on 429                                              |
| CORS    | open (`*`)                                                                                                                               |
| module  | `forms` and `api` both on                                                                                                                |

## Routes

| Route                                                         | Answers                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /me`                                                     | `{ alias, email, language, user_id }` — the key's maker                                                                                                                                                                                                              |
| `GET /workspaces`, `GET /workspaces/default`                  | one workspace, the site: `{ id: 'default', name, default, shared, forms: { count, href }, self }`                                                                                                                                                                    |
| `GET /forms`                                                  | `{ total_items, page_count, items[] }` — `search`, `page`, `page_size` (1–200, 10)                                                                                                                                                                                   |
| `GET /forms/{id}`                                             | the definition (below)                                                                                                                                                                                                                                               |
| `POST /forms` (cloud mode)                                    | a definition → a forms.md document, published at once: 201 with the definition read back; the id the title slugified or `id`; 400 `VALIDATION_ERROR` when the id exists (PUT it), the parser refuses a line, or nothing names the form                               |
| `PUT /forms/{id}` (cloud mode)                                | the whole definition again: 200 (201 created at that id); the refusals as POST's, and 400 `BAD_REQUEST` naming a type the runner has no kind for (`payment`, `legal`, `matrix`, `ranking`, `yes_no`, `contact_info`, `address`, `nps`) or a jump the rows cannot say |
| `PATCH /forms/{id}` (cloud mode)                              | a JSON Patch (RFC 6902: `add`, `replace`, `remove`, `move`, `copy`, `test`) on the definition as GET answers it, then written as PUT does; a path that is not there or a failed test is `VALIDATION_ERROR`                                                           |
| `DELETE /forms/{id}` (cloud mode)                             | 204; the document removed and the removal published; the responses stay                                                                                                                                                                                              |
| `GET /forms/{id}/responses`                                   | `{ total_items, page_count, items[] }` — the arguments below                                                                                                                                                                                                         |
| `DELETE /forms/{id}/responses?included_tokens=a,b`            | 204; the responses, their answers and their files removed (`included_response_ids` is taken too)                                                                                                                                                                     |
| `GET /forms/{id}/responses/{token}/fields/{ref}/files/{name}` | 302 to a signed address of the file, good for an hour                                                                                                                                                                                                                |
| `GET /forms/{id}/webhooks`                                    | `{ items: [webhook] }`                                                                                                                                                                                                                                               |
| `GET /forms/{id}/webhooks/{tag}`                              | a webhook                                                                                                                                                                                                                                                            |
| `PUT /forms/{id}/webhooks/{tag}`                              | body `{ url, enabled?, secret?, verify_ssl? }` → the webhook, 201 made or 200 updated; the tag `[a-zA-Z0-9_.-]{1,64}`                                                                                                                                                |
| `DELETE /forms/{id}/webhooks/{tag}`                           | 204                                                                                                                                                                                                                                                                  |
| `GET /insights/{id}/summary`                                  | the summary (below)                                                                                                                                                                                                                                                  |
| `/themes/…`, `/images/…`                                      | `NOT_FOUND` — a form is drawn in the site's design                                                                                                                                                                                                                   |

A form is one that is published and a form (`page = form-slides`); another id is `NOT_FOUND`.

## The definition

`{ id (the slug), type: 'form' | 'quiz', title, workspace: { href }, theme: { href }, settings: { language, progress_bar, meta: { allow_indexing, description }, is_public, show_progress_bar, show_question_number, autosave_progress, … }, welcome_screens: [{ id, ref, title, properties: { show_button, button_text, description } }] (a start slide), thankyou_screens: [{ id: 'default_tys', ref, title, type, properties: { show_button, button_mode: 'reload' | 'redirect', button_text, redirect_url? } }] (the end slide), fields: [group…], logic: [], created_at, last_updated_at, published_at, _links: { display, responses } }`.

A **group** per slide: `{ id: 'group-<n>', ref, title, type: 'group', properties: { fields: [field…], button_text, show_button } }`. A **field**: `{ id (the name), ref (the name), title (the question), type, properties, validations: { required, min_value?, max_value? } }` with the types `short_text`, `long_text`, `email`, `website`, `phone_number`, `number`, `dropdown` (`properties.choices[] { id, ref, label }`, `alphabetical_order`), `multiple_choice` (`choices`, `allow_multiple_selection`, `allow_other_choice`, `randomize`, `vertical_alignment`), `picture_choice` (`choices` with `attachment: { type: 'image', href }`, `supersized`, `show_labels`), `rating` (`steps`, `shape`), `opinion_scale` (`steps`, `start_at_one`, `labels: { left, center, right }`), `date` (`structure`, `separator`), `file_upload`; free markdown a `statement` (`title` its first line, `properties.description` the rest, `button_text`, `hide_marks`). The kind map is in the guide. **Logic**: `{ type: 'field', ref: <the field before the guarded slide>, actions: [{ action: 'jump', details: { to: { type: 'field' | 'thankyou', value } }, condition: { op, vars: [{ type: 'field', value }, { type: 'constant', value }] } }] }` — the ops `equal`, `not_equal`, `greater_than`, `lower_than`, `is`, `is_not`, `contains`, `or` of those; a condition the rows cannot say is `{ op: 'always' }` with `expression` beside the entry.

The list's item: `{ id, title, last_updated_at, created_at, settings: { is_public, is_trial }, self: { href }, theme: { href }, _links: { display, responses } }`.

## Responses

| Argument                | Meaning                                                                           |
| ----------------------- | --------------------------------------------------------------------------------- |
| `page_size`             | 1–1000, 25 by default                                                             |
| `since`, `until`        | submitted (or, for one not yet submitted, started) at or after / before, ISO 8601 |
| `after`, `before`       | the page after / before this token, in the order                                  |
| `included_response_ids` | a list of tokens                                                                  |
| `completed`             | `true`, `false`, `all` (default)                                                  |
| `sort`                  | `submitted_at,desc` (default), `submitted_at,asc`, `landed_at,asc                 | desc` |
| `query`                 | a word in any answer                                                              |
| `fields`                | only these fields' answers on each item                                           |
| `answered_fields`       | only responses that answered every one of these                                   |

An **item**: `{ landing_id, token, response_id (all the row's id), response_type: 'completed', landed_at, submitted_at (null while open), metadata: { user_agent, platform, referer, network_id, browser }, hidden: { … } (the page's query when the form was opened), calculated: { score }, variables: [{ key: 'score', type: 'number', number }] for a quiz, ending: { id, ref }, answers: [answer…] }` in the form's field order. An **answer**: `{ field: { id, type, ref }, type, <value> }` — `text` (`text`), `email` (`email`), `url` (`url`), `phone_number` (`phone_number`), `number` (`number`; rating and opinion scale too), `choice` (`choice: { id, ref, label }`), `choices` (`choices: { ids, refs, labels }`), `date` (`date`, ISO), `file_url` (`file_url`, the address under the Responses API). A field the form no longer has is left out.

## Webhooks

A **webhook**: `{ id, form_id, tag, url, enabled, verify_ssl, created_at, updated_at }` — never the secret. The **delivery**: `POST <url>` with `{ event_id, event_type: 'form_response', form_response: { form_id, token, landed_at, submitted_at, definition: { id, title, fields: [{ id, ref, title, type, properties, validations, choices? }] }, answers, hidden, calculated, variables, ending } }` under `Typeform-Signature: sha256=<base64 HMAC-SHA256 of the raw body, keyed by the secret>` and `X-Form: <slug>`; the document's own `webhook` gets the same body with `X-Form-Signature: sha256=<hex>` beside it, keyed by `FORMS_WEBHOOK_SECRET`. Once per completion per enabled subscription; a failure kept on the response (`meta.webhook_failed` by subscriber, `webhook_error`) and on the subscription (`last_error`), tried again on the form's next completion; `last_at` the last delivery. `form_webhooks` in the database: `id`, `form`, `tag`, `url`, `secret`, `enabled`, `verify_ssl`, `created_at`, `updated_at`, `last_at`, `last_error`, unique on (form, tag); the staff read under RLS, the API writes with the service role.

## Insights

`{ fields: [{ id, ref, title, type, views, dropoffs }], form: { platforms: [{ platform, responses_count, total_visits, unique_visits, completion_rate, average_time }], summary: { responses_count, total_visits, unique_visits, completion_rate, average_time } } }` — from `admin_forms`: visits are responses started, a field's views the responses that reached its slide, its drop-offs those that went no further.

## Errors

`{ code, description }`: `AUTHENTICATION_FAILED` (401: no key, a revoked one), `FORBIDDEN` (403: a key of another door), `NOT_FOUND` (404), `BAD_REQUEST` (400), `VALIDATION_ERROR` (400: an argument out of range, a bad tag or url), `METHOD_NOT_ALLOWED` (405: a write to a form in git mode), `TOO_MANY_REQUESTS` (429, `Retry-After`).

## The embed's side

`/to/<slug>` is the form's page (`ROUTES.to`, an alias of `/form/<slug>`). Under `?typeform-embed=<type>&typeform-embed-id=<id>` (`lib/forms/typeform-embed.js`) the runner posts to its parent `{ type, embedId, …}` with `type` one of `form-ready`, `form-theme` (`theme: { backgroundColor, color }`), `form-started`, `form-screen-changed` (`ref`: the slide's first field, or `slide-<n>`), `form-height-changed` (`height`), `form-submit` (`formId`, `responseId`), `form-close`.
