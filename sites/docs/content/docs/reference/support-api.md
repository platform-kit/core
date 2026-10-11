---
title: The Support API reference
description: Every route, field, event and error of the Chatwoot-compatible Support API a site serves, the snippet and window.$chatwidget — the reference; the guide is under Building a site.
order: 85.8
sources: [packages/kit/supabase/functions/support-api/index.ts, packages/kit/supabase/functions/_shared/support.ts, packages/kit/supabase/functions/_shared/api/chatwoot, packages/kit/supabase/functions/_shared/api/keys.ts, packages/kit/supabase/schemas/70-support.sql, packages/kit/src/lib/support/chat-widget.js, packages/kit/build/support-api.test.mjs]
reviewed: 2026-09-30
---

The guide is [The Support API, Chatwoot's](/content/docs/building-a-site/support-api). This page says exactly what is there.

A subscription carries a **source**: one somebody made through this API is `hand` and is theirs, and one a deployment ships declared in `platformkit.config.js` is `file` and is the projection's to replace — see [Declarations and state](/content/docs/building-a-site/declarations-and-state).

## Base, keys, headers

| | |
| --- | --- |
| the Client API | `https://<domain>/api/desk/public/api/desk/api/v1/inboxes/<inbox>/…` — `<inbox>` the site's space id; no key; the function's own address `https://<ref>.supabase.co/functions/v1/support-api/public/…` answers too |
| the Application API | `https://<domain>/api/desk/api/v1/accounts/<any>/…` and `https://<domain>/api/desk/api/v1/profile` — `api_access_token: <key>` (or a bearer), a key of kind `support` whose maker is on the desk; handed on by the storefront function under the `/api/*` rewrite |
| the deliveries | `POST …/support-api/deliver { event, id }` under the service bearer — the database's, never a client's |
| refusals | Chatwoot's `{ error, errors: [message] }`: 401 no token or a revoked one, 403 a key of another kind or a maker not on the desk, 404, 422 (a private note, a message that is not outgoing, no such agent, a bad webhook), 429 (the guards, the rate limit — `Retry-After`) |
| CORS | open (`*`) |

## The Client API

| Method and route | Does |
| --- | --- |
| `POST …/contacts` `{ custom_attributes?, path? }` | a guest: `{ id, source_id, name: null, email: null, identifier: null, pubsub_token: null, custom_attributes, additional_attributes: { verified } }`; the `source_id` is the contact's token (sha256 in the database); 429 past five new guests an hour from one address |
| `GET …/contacts/<source_id>` | the contact; 401 for an account's contact (the site's sign-in opens it) |
| `PATCH …/contacts/<source_id>` `{ custom_attributes }` | merged onto the contact's; a `name` or `email` given is not kept as identity |
| `GET …/contacts/<source_id>/conversations` | the contact's threads, latest first, each with its messages |
| `POST …/contacts/<source_id>/conversations` `{ path?, custom_attributes? }` | a thread, opening on the desk's default prompt (a system line) when the site has one; 429 past eight new threads an hour |
| `GET …/conversations/<id>` | `{ id, inbox_id: 1, status, contact_last_seen_at, agent_last_seen_at, messages, contact, custom_attributes, additional_attributes: { path, source }, pubsub_token }` |
| `GET …/conversations/<id>/messages?after=<unix>` | the lines, oldest first, 200 at most; a withdrawn one with `content` null and `content_attributes.deleted` |
| `POST …/conversations/<id>/messages` `{ content, echo_id? }` | the contact's line (4000 characters; one a second); the acknowledgement follows once as `message_type` 2 |
| `POST …/conversations/<id>/toggle_typing` `{ typing_status }` | the contact is typing (the inbox shows it) |
| `POST …/conversations/<id>/update_last_seen` | read up to now |
| `POST …/conversations/<id>/toggle_status` | resolved (a later line reopens it) |

A message: `{ id, content, inbox_id: 1, conversation_id, message_type (0 incoming · 1 outgoing · 2 activity), content_type: 'text', content_attributes, status: 'sent', private: false, created_at (unix seconds), sender ({ id, name, email, type: 'contact' | 'user', identifier, custom_attributes } — null for an activity line), attachments: [{ id, file_type: image | audio | file, extension, data_url (the site's signed url, an hour), thumb_url, file_size, duration? }], echo_id? }`; a voice note carries `content_attributes: { kind: 'voice', seconds }`. A bot's answer that ends in choices carries them as Chatwoot does: `content_type: 'input_select'` and `content_attributes: { items: [{ title, value }], taken? }` — `taken` is the value already chosen, since an offer is taken once. Taking one through the API is posting its `title` as the contact's line; the offer is marked only through the widget's own door.

## The Application API

| Method and route | Does |
| --- | --- |
| `GET …/conversations?status&assignee_type&page` | `{ data: { meta: { mine_count, unassigned_count, all_count }, payload: [conversation] } }` — `status` open · pending · resolved · all, `assignee_type` me · unassigned · all, 25 a page, latest first; each conversation without its messages |
| `GET …/conversations/<id>` | the conversation with its messages |
| `GET …/conversations/<id>/messages` | `{ meta: { contact, assignee, additional_attributes }, payload: [message] }` |
| `POST …/conversations/<id>/messages` `{ content, message_type: 'outgoing' }` | an agent's line as the key's maker (`agent_id`); the thread marked read by the agent; 422 for `private: true` or another `message_type` |
| `POST …/conversations/<id>/toggle_status` `{ status? }` | open · pending · resolved (none given: resolved, or open when resolved) → `{ payload: { success, current_status, conversation_id } }` |
| `POST …/conversations/<id>/assignments` `{ assignee_id }` | an agent's id (`profiles.id`, admin or support) → the agent; null or 0 unassigns → null; 422 for no such agent |
| `GET …/contacts?page` | `{ meta: { count, current_page }, payload: [contact] }`, by last seen |
| `GET …/contacts/<id>` | `{ payload: contact }` with `conversations_count` |
| `GET …/contacts/<id>/conversations` | `{ payload: [conversation] }` |
| `GET …/inboxes` | `{ payload: [{ id: 1, name, channel_type: 'Channel::WebWidget', website_token: <the space id>, website_url }] }` |
| `GET …/agents` | `[{ id, name, email, role: 'administrator' | 'agent', availability_status, confirmed }]` — everybody holding `admin` or `support`; `administrator` for the first of those |
| `GET /api/desk/api/v1/profile` | the key's maker as an agent, with `accounts` |
| `GET …/webhooks` | `{ payload: { webhooks: [{ id, url, subscriptions, last_at, last_error }] } }` |
| `POST …/webhooks` `{ url, subscriptions }` (or under `webhook`) | 201 `{ payload: { webhook } }`; 422 for a bad url or no known event |
| `PATCH …/webhooks/<id>` | the url or the subscriptions replaced |
| `DELETE …/webhooks/<id>` | 204 |

A conversation: `{ id, inbox_id: 1, account_id: 1, status, muted: false, can_reply: true, channel: 'Channel::WebWidget', timestamp, created_at, updated_at (unix seconds), unread_count (the contact's lines since the agent read), first_reply_created_at, waiting_since (the first unanswered line's time), agent_last_seen_at, contact_last_seen_at, additional_attributes: { path, source, prompt_id, resolved_at }, custom_attributes, labels: [], messages, last_non_activity_message, meta: { sender, assignee, hmac_verified: false } }`. A contact: `{ id, name (Guest for a guest), email, identifier (the user id), custom_attributes, additional_attributes: { kind: guest | user | customer, verified, last_path, notes, orders }, contact_inboxes: [{ source_id, inbox }], created_at, last_activity_at }` — `source_id` is never answered to the desk (it is the contact's secret).

## Webhooks

`support_webhooks` (`id`, `url`, `subscriptions`, `created_by`, `last_at`, `last_error`; the staff read under RLS, the service role writes). Events: `conversation_created` (an insert), `conversation_status_changed`, `conversation_updated` (the assignee or the custom attributes), `message_created` (every line — a contact's, an agent's, a system one), `contact_created`; `message_updated`, `contact_updated` and `webwidget_triggered` are accepted in a subscription and never sent. The triggers (`support_api_on_message`, `support_api_on_conversation`, `support_api_on_contact`) ask `support_api_notify(event, id)`, which posts to the function over pg_net with `app_settings`' url and secret — nothing while no subscription exists. The payload: for a message, `{ event, id, content, message_type: 'incoming' | 'outgoing' | 'activity', content_type, content_attributes, created_at (ISO), sender, attachments, conversation (with meta, without messages), inbox: { id, name }, account: { id, name } }`; for a conversation, `{ event, …the conversation with its messages, inbox, account }`; for a contact, `{ event, …the contact, account }`. A delivery is one POST with a JSON body; a non-2xx answer is kept as `last_error`.

## The snippet and `window.$chatwidget`

`GET /api/desk/packs/js/sdk.js` — one script (Vue and the widget inside; ~165 KB gzipped), built by the `support-sdk` step into `dist/api/desk/packs/js/sdk.js`, the dev server serving it once built (`node build/support-sdk.mjs`). `window.chatwootSDK.run({ websiteToken, baseUrl })` mounts the widget once; `websiteToken` must equal the site's space id, and `baseUrl` (else the script's own origin) is the site every path of ours resolves against — a prompt's picture included. The bundle carries the theme's tokens and the site's look, and styles nothing outside the widget: the page it lands on keeps its own type and colour. `window.$chatwidget` — and `window.$chatwoot`, the same object: `hasLoaded` (true), `isOpen`, `toggle(state?)`, `toggleBubbleVisibility(state?)`, `popoutChatWindow()` (opens `<baseUrl>/support`), `setUser(identifier, attrs)`, `setCustomAttributes(attrs)`, `deleteCustomAttribute(key)`, `setConversationCustomAttributes(attrs)`, `deleteConversationCustomAttribute(key)` (kept for the next conversation), `setLabel`, `removeLabel`, `setLocale` (no-ops), `reset()`. Events on `window`: `chatwidget:ready`, `chatwidget:on-message` (`detail.message`) and `chatwidget:error`, each fired under Chatwoot's name beside it (`chatwoot:ready`, `chatwoot:on-message`, `chatwoot:error`) with the same detail. The same object is on the site's own pages. The loader keeps Chatwoot's name (`window.chatwootSDK.run`), since their snippet calls it; `window.PlatformKitSupport.run` is the same loader. `/support` (`ROUTES.support`, `noindex`, no chrome) is the panel on a page of its own.

## The keys

`api_keys.kind` gains `support` (Settings → API: **Support** — *the desk: conversations, replies, contacts, webhooks*). The module switches are `support` and `api`.
