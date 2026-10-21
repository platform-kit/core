---
title: The Forms API, Typeform's
description: A site's forms served as Typeform's Create (read, and written in cloud mode), Responses, Webhooks and Insights APIs, and Typeform's embed pointed at the site — the guide; the reference lists every route, argument and field.
order: 56.95
sources:
  [
    packages/kit/supabase/functions/forms-api,
    packages/kit/supabase/functions/_shared/api/typeform,
    packages/kit/supabase/functions/form,
    packages/kit/build/forms.mjs,
    packages/kit/build/steps/forms.mjs,
    packages/kit/src/lib/forms/api-shape.js,
    packages/kit/supabase/functions/_shared/forms-live.ts,
    packages/kit/src/lib/forms/typeform-embed.js,
    packages/kit/build/forms-api.test.mjs,
    packages/movable-types/src/components/forms/FormRun.vue,
    packages/movable-types/src/components/admin/FormBuilder.vue,
  ]
reviewed: 2026-10-21
---

## What it is

The API answers in its own room, `/api/forms` — so Typeform's own `/forms` sits inside it and the word doubles (`/api/forms/forms/{id}`). That is deliberate: `@typeform/api-client` builds the `/forms` part itself, so trimming it would rewrite their path.

A site with the forms module on serves its forms the way **Typeform** serves theirs: the Create API (every published form as Typeform's definition — and in cloud mode, forms written as Typeform's client writes them), the Responses API (every response with its answers typed by kind), the Webhooks API (subscriptions, delivered as Typeform delivers) and the Insights summary — at `https://<domain>/api`, through the `/v1/*` rewrite every site already has. Anything written against `api.typeform.com` works with the base changed; Typeform's official client takes it as one option, and so does its embed library. The reference — every route, argument, field and error — is [The Forms API reference](/content/docs/reference/forms-api).

```js
import { createClient } from '@typeform/api-client'
const client = createClient({
  token: '<a forms key>',
  apiBaseUrl: 'https://northlight.example.com/api/forms',
})
const { items } = await client.forms.list()
const form = await client.forms.get({ uid: 'contact' })
const responses = await client.responses.list({ uid: 'contact', pageSize: 100, completed: 'true' })
await client.webhooks.create({
  uid: 'contact',
  tag: 'crm',
  url: 'https://crm.example.com/hook',
  enabled: true,
  secret: 'shh',
})
```

The key is of kind **Forms**, made under Settings → API. There is no public reading, whatever `api.public` says: responses are people's answers. A key of another kind at this door is `FORBIDDEN`.

## The definition

`GET /forms/{id}` is the form as Typeform describes one. The id is the form's slug; a field's `id` and `ref` are its name, a choice's its value. The kinds map: `text` → `short_text`, `email`, `url` → `website`, `tel` → `phone_number`, `password` → `short_text`, `number`, `select` → `dropdown`, `choice` → `multiple_choice` (its `choices`, `allow_multiple_selection`), picture choice → `picture_choice` (each choice with an image attachment), `rating` (`steps`), opinion scale → `opinion_scale` (`steps`, `start_at_one`, the end labels), `datetime` and `date` → `date`, `time` → `short_text`, `file` → `file_upload`. Every slide is a `group` holding its fields; free markdown is a `statement`; a start slide is a `welcome_screen` and the end slide a `thankyou_screen` (with the redirect, when the document names one); a slide's jump condition is a `logic` entry on the field before it — a jump past the slide when the condition does not hold (a condition the builder's rows cannot say is kept as `always`, with the expression beside it); the quiz's score makes the form a `quiz`. `_links.display` is the form's page, `/to/<slug>`.

## Writing a form (cloud mode)

In cloud mode (`CONTENT_STORE=cloud`) the Create API writes too: `forms.create({ data })`, `forms.update({ uid, data, override: true })` (the whole definition again), `forms.update({ uid, data: [ …a JSON Patch ] })` and `forms.delete({ uid })` — `POST /forms`, `PUT`, `PATCH`, `DELETE /forms/{id}`. A definition is turned into a **forms.md document** (`_shared/api/typeform/document.js`, the reverse of `definition.js`, over the forms model's writer — the same Composer the builder saves through): a `group` a slide, a top-level field a slide of its own, every type back to its kind with its properties (choices, steps, labels, validations; `long_text` a multiline text), a `statement` free markdown, `welcome_screens[0]` and `thankyou_screens[0]` the start and end slides (the button, a redirect), `settings` the document's `#!` lines (the title, `meta.description`, `is_public` → `published`, the progress bar), and the `logic` the jump conditions the rows can say — a jump from the last field of a screen past the screen after it, under a condition of `equal`, `not_equal`, `greater_than`, `lower_than`, `is`, `is_not` (or an `or` of them), becomes that screen's condition negated. The id is the title slugified, or the `id` given (a `POST` at an id that exists is refused: `PUT` it). The document goes through the content pipe for the `forms` model — the parser's refusals come back as `VALIDATION_ERROR` naming the line — and is **published at once** and pushed, as Typeform has no draft; the runner shows it at `/to/<id>` the moment it is saved, since in cloud mode the functions read the forms from the rows (`_shared/forms-live.ts`) and the site's pages from the same rows. A type the runner has no kind for — `payment`, `legal`, `matrix`, `ranking`, `yes_no`, `contact_info`, `address`, `nps` — is refused 400 naming it, and so is a jump the rows cannot say (another target, `contains`, `begins_with`, `and`, an unconditional jump). In git mode the writes answer `METHOD_NOT_ALLOWED`: a form is written in the admin.

## Responses

`GET /forms/{id}/responses` takes every argument Typeform's does — `page_size`, `since`, `until`, `after`, `before`, `included_response_ids`, `completed`, `sort`, `query`, `fields`, `answered_fields` — and answers `total_items`, `page_count` and `items[]`: `token` and `response_id` (the row's id), `landed_at` (started), `submitted_at` (completed), `metadata` (the user agent, the referer, the platform), `hidden` (the page's query when the form was opened — a campaign's parameters), `calculated.score` for a quiz, and `answers[]` each `{ field: { id, type, ref }, type, … }` in Typeform's value types: `text`, `email`, `url`, `phone_number`, `number`, `choice` (`id`, `ref`, `label`), `choices` (`ids`, `refs`, `labels`), `date`, `file_url`. A file's url is under the Responses API — `/forms/{id}/responses/{token}/fields/{ref}/files/{name}` — and a key opens it (a redirect to a signed address, good for an hour). `DELETE /forms/{id}/responses?included_tokens=a,b` removes responses with their answers and files; the client's `responses.delete({ uid, ids })` sends exactly that.

## Webhooks

`PUT /forms/{id}/webhooks/{tag}` with `{ url, enabled, secret, verify_ssl }` subscribes; `GET …/webhooks` lists, `GET` and `DELETE …/webhooks/{tag}` read and remove one. Any number per form, kept as rows (`form_webhooks`); the secret is what signs and is never answered back. Every completed response is delivered once to each enabled subscription as Typeform's payload — `{ event_id, event_type: 'form_response', form_response: { form_id, token, landed_at, submitted_at, definition: { id, title, fields }, answers, hidden, calculated } }` — under `Typeform-Signature: sha256=<base64 HMAC-SHA256 of the raw body>`; a failure is kept on the response, per subscriber, and tried again on the form's next completion. The document's own `webhook` setting still works and now receives the same payload, signed with the site's secret (`FORMS_WEBHOOK_SECRET`, else derived) — under `Typeform-Signature` and the `X-Form-Signature` it always had. The form's Settings in the admin list the subscriptions read-only, with the last delivery or the last error.

## Insights, me, workspaces

`GET /insights/{id}/summary` is Typeform's summary from the numbers the admin keeps: visits, submissions, the completion rate, the average time, and per field its views and drop-offs. `GET /me` and `GET /workspaces` answer the client's handshake (one workspace: the site).

## Typeform's embed

The form's page answers at `/to/<slug>` as well as `/form/<slug>` — Typeform's address shape — and, opened inside Typeform's embed, speaks its messages (`form-ready`, `form-theme`, `form-started`, `form-screen-changed`, `form-height-changed`, `form-submit` with the response's token, `form-close`), so `@typeform/embed` shows the site's form on an outside page, sized as it would size Typeform's, with its callbacks firing:

```html
<div
  data-tf-widget="contact"
  data-tf-domain="northlight.example.com"
  style="width:100%;height:600px"
></div>
<script src="//embed.typeform.com/next/embed.js"></script>
```

```js
import { createWidget } from '@typeform/embed'
createWidget('contact', { container, domain: 'northlight.example.com', onSubmit: ({ responseId }) => … })
```

The popup, the slider and the side tab work the same way. The form's Share tab in the admin shows the snippet. The origin rule holds: a page on an origin the form does not list under _Sites that may embed it_ sees the form refuse. (The library builds `https://` addresses from a domain; on a local dev server give it the whole address as the form id instead, `createWidget('http://localhost:5173/to/contact', …)`.)

## Where the shapes are, and what checks them

`_shared/api/typeform/` — `definition.js` (a compiled form to Typeform's definition), `response.js` (a row to an item; the webhook payload), `query.js` (the Responses arguments as one plan), `insights.js`, `errors.js` — plain JavaScript the function and the test share. `build/forms.mjs` compiles beside the contract what the definition needs — `src/lib/forms/api-shape.js`: each field's words and choices, the slides with their jump conditions as rows and their free markdown, the start and end slides; the file's times — as the `forms` build step (`platformkit run forms`); the admin runs it on every save. `build/forms-api.test.mjs` (in `platformkit test` with forms and api on; `FORMS_API_TEST=0` skips it) pins the shapes under Node over a document of every kind, and — with the stack up — runs `@typeform/api-client` against the served function, the refusals, a webhook delivered and verified with its secret, a response deleted, the insights, and `@typeform/embed` on a page of another origin under Playwright.

## What is not there, on purpose

Writing forms in git mode (the documents are files in a checkout: `POST`, `PUT`, `PATCH`, `DELETE /forms…` answer `METHOD_NOT_ALLOWED` there); Typeform's Themes and Images APIs (a form is drawn in the site's design); hidden fields beyond the page's query; Typeform's own token shape (`tfp_…`); payment and signature fields the runner has no counterpart for.
