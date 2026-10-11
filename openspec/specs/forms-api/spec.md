# forms-api

## Purpose

A site's forms served as Typeform's APIs — the Create API (read, and written in cloud mode), Responses, Webhooks and Insights — under a forms key, with Typeform's embed pointed at the site, so Typeform's client and embed work with the base changed.

## Requirements

### Requirement: The forms are Typeform's API

A site with the `forms` and `api` modules on SHALL serve its forms as Typeform's API at `https://<domain>/v1/forms-api` (the `/v1/*` rewrite; the `forms-api` function's own address answering too) under a key of kind `forms` made in Settings → API — never without a key, whatever `api.public` says, since responses are people's answers — so that `@typeform/api-client`'s `createClient({ token, apiBaseUrl })` and any code written against `api.typeform.com` work with the base changed. **The Create API's read side**: `GET /forms` (Typeform's list — `total_items`, `page_count`, `items[]` with `id`, `title`, `last_updated_at`, `created_at`, `self`, `_links.display`, `_links.responses`; `search`, `page`, `page_size`) and `GET /forms/{id}` (the definition — `id`, `type`, `title`, `settings`, `welcome_screens` from a start slide, `thankyou_screens` from the end slide, `fields[]` in Typeform's types with `id`, `ref`, `title`, `properties`, `validations`, a `group` per slide holding its fields, `statement` for free markdown, `logic[]` from the jump conditions, `_links.display` the form's page) for every published form, the id its slug, a field's id and `ref` its name. **The Responses API**: `GET /forms/{id}/responses` with `page_size` (1–1000, 25 by default), `since`, `until`, `after`, `before`, `included_response_ids`, `completed`, `sort`, `query`, `fields`, `answered_fields`, answering `total_items`, `page_count`, `items[]` — `landing_id`, `token`, `response_id`, `landed_at`, `submitted_at`, `metadata` (`user_agent`, `platform`, `referer`, `network_id`, `browser`), `hidden`, `calculated.score` for a quiz, `answers[]` each `{ field: { id, type, ref }, type, <value by type> }` as Typeform types them (`text`, `email`, `url`, `phone_number`, `number`, `boolean`, `date`, `choice`, `choices`, `file_url` — a signed url into the forms bucket, an hour) — and `DELETE /forms/{id}/responses?included_tokens= (Typeform's name; included_response_ids taken too)`. **Insights**: `GET /insights/{id}/summary` in Typeform's shape from the analytics the admin already computes. **The handshake**: `GET /me` (the key's maker as `alias`, `email`, `user_id`, `language`) and `GET /workspaces` (one workspace, the site). Errors SHALL be Typeform's (`{ code, description }`: `NOT_FOUND`, `AUTHENTICATION_FAILED`, `FORBIDDEN`, `BAD_REQUEST`, `TOO_MANY_REQUESTS`); the rate limit the api module's, with `Retry-After`. Writes to forms (`POST/PUT/PATCH/DELETE /forms…`) SHALL answer `METHOD_NOT_ALLOWED` until the management change.

#### Scenario: the official client, one base changed

- **WHEN** `@typeform/api-client` is created with `{ token: <a forms key>, apiBaseUrl: <domain>/v1/forms-api }` on the demo and asked `forms.list()`, `forms.get({ uid })`, `responses.list({ uid, pageSize, completed: 'true' })`, `me()` and `workspaces.list()`
- **THEN** every call answers Typeform's shape: the list names every published form with its display link, the definition holds a field per document field in Typeform's type (the demo's every-kind form: `short_text`, `long_text`, `email`, `website`, `phone_number`, `number`, `dropdown`, `multiple_choice` with its `choices`, `picture_choice`, `rating`, `opinion_scale`, `date`, `file_upload`) and a `logic` entry for its jump, and the responses list carries the seeded responses with `answers[]` typed by kind, the file as a `file_url` that downloads

Verified by: `build/forms-api.test.mjs` on the demo — the client against the served function, the shapes against Typeform's documented ones field for field

#### Scenario: no key, a wrong key, a delivery key

- **WHEN** `/v1/forms-api/forms` is fetched with no key, with a revoked forms key, and with a content delivery key
- **THEN** each answers 401 `AUTHENTICATION_FAILED` (the delivery key 403 `FORBIDDEN`) in Typeform's error shape, whatever `api.public` says

Verified by: the test

#### Scenario: a response deleted

- **WHEN** `DELETE /forms/{id}/responses?included_tokens= (Typeform's name; included_response_ids taken too)<token>` is called under a forms key
- **THEN** the response and its answers are gone, its file removed from the bucket, and the admin's Responses no longer lists it

Verified by: the test — the rows and the bucket

### Requirement: Webhooks are subscriptions, delivered as Typeform delivers

A form SHALL take any number of webhook subscriptions through Typeform's Webhooks API — `PUT /forms/{id}/webhooks/{tag}` with `{ url, enabled, secret, verify_ssl }`, `GET /forms/{id}/webhooks`, `GET` and `DELETE …/webhooks/{tag}` — kept as rows of `form_webhooks` (the secret kept whole, since it is what signs; readable by the service role alone and never answered back after creation) and shown, read-only, on the form's page in the admin. Every completed response SHALL be delivered once to each enabled subscription, and to the document's own `webhook` setting, as Typeform's payload — `{ event_id, event_type: 'form_response', form_response: { form_id, token, landed_at, submitted_at, definition: { id, title, fields[] }, answers[], hidden, calculated } }` — signed `Typeform-Signature: sha256=<base64 HMAC-SHA256 of the raw body>` (the document's subscriber also gets the `X-Form-Signature` it had); a failed delivery SHALL be kept on the response and retried on the form's next completion, as today.

#### Scenario: a subscription receives a completion

- **WHEN** a webhook is put on a form through the client (`webhooks.create({ uid, tag, url, enabled: true, secret })`), a response is completed on the runner, and the receiver checks the signature with the secret
- **THEN** the receiver has one `form_response` payload whose `answers[]` match the response, the signature verifies, `GET …/webhooks` lists the subscription with `enabled: true`, and after `DELETE` the next completion is not delivered

Verified by: the test with a local receiver, as the forms spec's webhook scenario runs today

### Requirement: Typeform's embed points at the site

The runner SHALL answer at `/to/<slug>` as well as `/form/<slug>` and, when opened by `@typeform/embed` (its `typeform-embed`, `typeform-embed-id`, `typeform-source`, `typeform-medium` parameters), SHALL speak the embed's messages to its parent — `form-ready`, `form-theme`, `form-started`, `form-screen-changed`, `form-height-changed`, `form-submit` (with the response's `token` as `responseId`), `form-close` — so `createWidget`, `createPopup`, `createSlider` and `createSidetab` with `{ domain: '<domain>' }` (and the `data-tf-*` attributes with `data-tf-domain`) show the site's form on an outside page, sized and reported as Typeform's would be; the origin rule of the forms spec SHALL hold (a page on an origin the form does not allow sees the form refuse).

#### Scenario: the widget on another origin

- **WHEN** a page on another local port runs `createWidget('<slug>', { container, domain: 'localhost:5173', onSubmit })` for a form allowing that origin
- **THEN** the form appears inline at the height it reports, `onReady` and `onQuestionChanged` fire as the reader moves, finishing fires `onSubmit` with a `responseId` the Responses API then lists; the same on an origin not allowed shows the runner's refusal

Verified by: the test on Playwright — a local page with `@typeform/embed`, the callbacks recorded, screenshots at 1280 and 390

### Requirement: Forms are written as Typeform writes them

In cloud mode the Forms API SHALL take Typeform's Create API writes under a forms key — `POST /forms` (a definition; the id from its `title` slugified, or given), `PUT /forms/{id}` (the whole definition again), `PATCH /forms/{id}` (a JSON Patch on the definition, as Typeform takes one), `DELETE /forms/{id}` — each turned into a forms.md document by the forms model's writer: a `group` a slide, every field type back to its kind with its properties (choices, steps, labels, validations), a `statement` free markdown, `welcome_screens` and `thankyou_screens` the start and end slides, `logic` the jump conditions the rows can say (a jump the rows cannot say is refused 400 naming it), `settings` what the kit's settings hold; drafted through the pipe (the model's checks, the parser's refusals as 400 `VALIDATION_ERROR` with the line) and published as the admin publishes. A type the runner has no kind for (`payment`, `legal`, `matrix`, `ranking`, `yes_no`) SHALL be refused naming it. In git mode the writing methods SHALL answer 405 as today.

#### Scenario: a form created and published through the client

- **WHEN** `@typeform/api-client` on the demo in cloud mode calls `forms.create({ data })` with a definition of two groups, a short_text, an email, a multiple_choice with three choices, an opinion_scale, a statement, a welcome and a thank-you screen and one logic jump, then `forms.update` changing a title, then publishes it through the Management API's publish route
- **THEN** the document under `content/forms/<id>.md` parses as forms.md, the runner shows it at `/to/<id>` with the fields as given, `forms.get` answers the definition back with the same fields and logic, and `forms.delete` removes it

Verified by: `forms-api.test.mjs` on the demo in cloud mode — the round trip definition → document → definition, the page by Playwright
