---
title: Forms internals
description: The document, the parser and its model, the vendored parts of forms.md, the runner, the function, the embed, the builder's writer.
order: 56.5
sources: [packages/kit/src/lib/forms, packages/kit/vendor/formsmd, packages/kit/build/forms.mjs, packages/kit/build/form-io.mjs, packages/kit/build/form-embed.mjs, packages/kit/build/forms.test.mjs, packages/kit/supabase/functions/form, packages/kit/supabase/functions/_shared/forms/score.js, packages/kit/supabase/schemas/25-forms.sql, packages/movable-types/src/instrument/ui/screens/form, packages/movable-types/src/components/forms, packages/movable-types/src/components/landing/LandingForm.vue, packages/movable-types/src/embed.js, packages/movable-types/src/pages/FormPage.vue, packages/kit/build/embed-content.mjs]
reviewed: 2026-10-01
---

The forms module is forms.md's language on the kit's own runner, with the backend forms.md lacks. This page is how it is put together; [Forms](/docs/running-a-site/marketing/forms) is what it does.

A form's webhook subscriptions carry a **source**: one made through the Forms API is `hand` and is the subscriber's, and one a deployment ships declared in `platformkit.config.js` is `file` and is replaced by the projection on every deploy — see [Declarations and state](/content/docs/building-a-site/declarations-and-state).


> The compile (`build/forms.mjs`) runs **over the store**, so the same code answers from a checkout on a
> machine and from the rows in an Edge Function — which is what lets a publish make this artefact
> where the deployment will never build again ([cloud mode](/content/docs/running-a-site/settings/cloud-mode)).

## The document

`content/forms/<slug>.md` is a [forms.md](https://docs.forms.md) document, exactly — no frontmatter of the kit's own. Its `#! key = value` settings are the frontmatter: forms.md's (`title`, `page`, `page-progress`, `slide-controls`, `restart-button`, `submit-button-text`, `autofocus`, `button-alignment`, `dir`, `slide-delimiter`, `form-delimiter`…) and the kit's few:

| Setting | Meaning |
| --- | --- |
| `published` | `false` keeps the form off the site (the function answers *closed*) |
| `once` | `true`: one response per person; a second is refused |
| `respond` | `anyone` (default) or `authenticated` |
| `embed-origins` | the origins another site may embed it from, comma-separated |
| `webhook` | a url every finished response is posted to |
| `pass` | a quiz's pass mark, in right answers |
| `score` | the right answers, `field: answer, field: answer` (a choice allowing several: `field: a \| b`) |

forms.md's theming settings (`accent`, `color`, `font-family`, `rounded`…) are read and ignored: the site's design draws the form. `post-url`, `get-url` and `post-sheet-name` are refused — the kit's backend is where the data goes.

A document begins with `#!` lines, never with `---` (velite would read a leading rule as frontmatter).

## The vendored parts

`packages/kit/vendor/formsmd` holds the separable parts of `formsmd@1.1.3` (Apache-2.0; `NOTICE` names every change): `settings-parse.js` (the sixty settings and their validation), `attrs-parse.js` (the `[#id .class attr="v"]` grammar), `data-blocks-parse.js` (the ```` ```data ```` JSON blocks), `phone-numbers.js` (placeholders and calling codes by country), `composer.js` (the Composer: a document written from calls) and `field-parse.js` — the field-line pattern and every kind's parameter parsing factored out of the original `form-field-create.js` as a pure function, the HTML it emitted left behind. Their own tests are under `vendor/formsmd/tests`, run as they were written by `build/forms.test.mjs` over a small Jest shim. Not vendored: the renderer, the stylesheet, the translations (a form's words are the kit's `forms` strings scope), the Google Apps Script, the CLI.

## The parser and the model

`src/lib/forms/parse.js` reads a document into the model everything else works from: `{ settings, kit, data, slides, fields, head, warnings, errors }`. A slide is `{ type: start | body | end, jump, progress, align, post, disablePrev, button, redirect, head, blocks }`; a block is copy (`markdown`: the markdown and the names it binds), a field (`name`, `kind`, `required`, `params`, `attrs`, `condition`, `deps`) or a div (`attrs`, `blocks`). Every block carries `raw`, its source lines, and `line`, where it began.

The language is read as forms.md's docs describe it: a slide boundary is the delimiter on a line of its own (never inside a code fence); `-> start [-> button]`, `-> end [-> url]`, `-> condition`, `|> progress`, `=| alignment`, `<< disable`, `>> post` are a slide's directives; a paragraph matching the field pattern is a field (a field closed on one line followed by another field's line is read as two — forms.md would run them together, the one place the kit reads more generously); `::: [{$ a b $}] … :::` is a bind div (with one block inside, that block carries the whole div as its source); `{% if … %} … {% endif %}` round blocks gives each its condition (`else` and `elif` become the negations); `{$ name $}` in copy is a binding. Errors — a refused setting, a field that does not close, a name given twice, a right answer naming no field, a bad kit setting — carry a line and fail the build (velite's `forms` collection) and the admin's save; an invalid parameter is a warning, as forms.md warns.

The compiled entry (`.velite/forms.json`) is the model without its source lines, plus `slug`, `title`, `published` and the fields' questions. `build/forms.mjs` writes `supabase/functions/_shared/forms.json` — per form, the field contract the function checks a post against (name, **question**, kind, required, a choice's values, the slide) with the kit's settings — run by deploy, by the admin's save, by `npm test --check`.

The **question** is in the contract, and not only in the document, because anything that reads an
answer *back* needs it: a booking's answers on the desk, the same answers in a host's letter. A
field's key is not a question, and `working_on` in front of somebody who has to act on the answer
is a small daily insult to whoever wrote the form. forms.md's own `...` — its placeholder for a
field never given one — counts as no question, and then the key is all there is.

## The runner

`src/lib/forms/screens.js` turns the model into the runner's screens: one per slide (kind `form`), start slides first, the end — the document's or the default — last; `page = single` is one screen of every block; `slides` is the same screens with nothing posted. A slide's jump is the screen's `skip()`: read at the moment the screen would be shown, over the answers so far, which is forms.md's rule for the next slide. `src/lib/forms/logic.js` evaluates conditions and renders bindings with nunjucks — the engine forms.md uses, so an expression means the same thing — over the data blocks under the answers. `markdown.js` renders a copy block: the bindings first, then marked with forms.md's block attributes honoured (`[.text-center]` on a paragraph, a heading or a list, the classes prefixed `fmd-`, which the form stylesheet defines). `validate.js` is what a kind accepts, by kind, with the messages from the `forms` scope.

The screens are the theme's: `FormScreen.vue` (a slide: its blocks through `FmBlocks.vue`, each shown while its condition holds; the validation; the post through the host's `submit`; the end slide's states), the fields `FmText` (text, email, url, tel, password, number, date, time, datetime), `FmSelect`, `FmChoice` (choice and picture choice), `FmRecord` (voice and video: an answer somebody SAYS rather than types — the chat's own MP3 recorder for a voice note, MediaRecorder for a video, and either way a File that goes to the forms bucket like any other file answer, so nothing past the field knows it was recorded), `FmRating`, `FmScale`, `FmFile`, and `FmCopy` for the copy. `FormRun.vue` is the host: the model → screens, the answers, each slide posted as it goes (`lib/forms/api.js`), the resume from the server (the slide after the last posted), the progress bar, the slide controls (the runner's `back()`), the states before a form starts. It emits `complete` with the answers, the grade and the **response's own id** — what a caller that must point at what was answered has to hold on to, such as a space asking a form of somebody at its door. It wears `.qz`, the instrument's material, so every look paints it; `forms.css` is the fields' own styles and forms.md's utility classes.

One runner: `Typeform.vue` gained the `form` kind and a `back()`; the instrument's rounds are screens of the same component, untouched.

## The backend

`schemas/25-forms.sql`: `form_responses` (a row per person per form — somebody by `user_id`, a guest by `anon_id` — started, completed, a quiz's score, the webhook's delivery) and `form_answers` (a row per field, unique per response, replaced when answered again, with its slide and time; a file's path in the private `forms` bucket). Somebody reads their own rows and the staff every row under RLS; nothing is written from a client. `admin_forms(days)` is the analytics, answered for whoever may see the figures (`may_see_figures()` — an administrator or an analyst): per form, started, finished, completion, passed, the average time to complete, the last response, a series a day, each slide's reach and each field's answers counted by value (a string over sixty characters never counted) — what Forms → Form analytics draws one form at a time.

The `form` function (no JWT required): a multipart POST is a slide — `_form`, `_slide`, `_end`, the fields by name, a file as itself — checked against `forms.json` (an unknown field, a value not among the choices, a file on a field that is not one: refused), written to the open response (found or made; a `once` form with a completed response refuses), `_end` closing it, grading the quiz (`_shared/forms/score.js`, shared with the runner) and delivering the response once to every webhook — the subscriptions the Forms API keeps (`form_webhooks`) and the document's own `webhook` — as Typeform's `form_response` payload under `Typeform-Signature` (base64 HMAC-SHA256; the document's subscriber also gets the `X-Form-Signature` hex it always had, keyed by `FORMS_WEBHOOK_SECRET`, else derived from the service key), a failure kept on the row per subscriber and tried again on the form's next completion (see [the Forms API](/content/docs/building-a-site/forms-api)). The row keeps what the Responses API says of a visit (`meta`: the user agent, the referer, the page's query as `hidden`). `{ action: 'get', form }` is what this person has answered so far. The identity is the JWT, else `X-Form-Anon` (the analytics' anonymous id). An embed's page says where it is (the request's Origin), checked against `embed-origins`; the site's own origin — and locally any localhost port — always passes.

## The doors

`ROUTES.form` (`/form/<slug>`, `FORMS_ON`) and its alias `ROUTES.to` (`/to/<slug>`, Typeform's address shape, where Typeform's embed looks — `lib/forms/typeform-embed.js` speaks the embed's messages from the runner) → `FormPage.vue`, no layout; the prerender lists every published form and writes `form.md` (the document) and `form.json` (the model) beside its page. `LandingForm.vue` is the `Form` section (registered with the module on; its schema offers the site's forms by slug). The embed is `src/embed.js`, built by `build/form-embed.mjs` into `dist/form.js` and `dist/form.css` after the site's build (`platformkit build` runs it; the forms, the strings and the site's Supabase address are baked in; the CRDT store is aliased to `lib/store-light.js`, plain localStorage, so its WASM stays on the site). The shared diagnostic runner also imports the semantic search embedder, which forms never use; the embed build replaces that import with an explicit unavailable error so its top-level-await WASM is neither pulled into the one-file IIFE nor downloaded by form readers. The snippet mounts every `[data-platformkit-form]` on the host page. It is a step of the `site` phase, so it builds with the kit's plugin but **without its content pipeline** (`content: false`): velite and everything derived from it are already written by then, and the embed never rebuilds the search index's embeddings.

## The builder's writer

`build/form-io.mjs` reads a form for the admin and writes it back through forms.md's Composer: a block the builder touched (`dirty`) is composed afresh (`composeField`: the model's parameters to the Composer's names, a condition as its bind div); every untouched part is written from its `raw` source, byte for byte — so a hand-written construct the builder has no control for survives a save, and a document nothing changed in is the file as it was. Settings change in place (`settingsChanges`: a key replaced on its own line, a new one appended, a theming line the builder never shows kept as written). The result is parsed again before it is written, and refused with its errors. The forms are a model of the admin's registry (`build/models/core/forms.mjs`: the grammar over `form-io.mjs`, the builder as its editor, `create` as its action, the compile as its hook) served by the pipe like every model; each write compiles `forms.json`.

## Tests

`build/forms.test.mjs`: the vendored tests, the parser over `build/fixtures/forms/every-kind.md` (every kind, conditions, a jump, a binding, a data block, a div, an if/else), the refusals, the writer's round trip, the logic, the screens by page mode, the validation by kind, the grade. `deploy-checks` refuses `instrument` on with `forms` off. The parity with forms.md was established once, in the build (the change's `verify.md`), and is not kept as a suite: the fixtures are the pin.
