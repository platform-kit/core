# support-api

## Purpose

The support desk served as Chatwoot's Client and Application APIs with webhooks, and Chatwoot's website snippet mounting the site's own widget on any page — so a contact who arrives through the API is the same guest of the desk, and anything written for Chatwoot works with the base changed.

## Requirements

### Requirement: The desk is Chatwoot's Client and Application APIs

A site with the `support` and `api` modules on SHALL serve its desk as Chatwoot's APIs from one `support-api` function: the **Client API** at `/public/api/v1/inboxes/<inbox>/…` — the inbox identifier the site's space id, no token, the same guards as the widget — with contacts (`POST` a guest, `GET` and `PATCH` by `source_id`, which is the contact token), a contact's conversations (`GET`, `POST`), a conversation's messages (`GET`, `POST`), `toggle_typing` and `update_last_seen`; and the **Application API** at `/api/v1/accounts/<id>/…` under a key of kind `support` sent as `api_access_token` (or a bearer) — conversations (list by `status` and `assignee_type` with Chatwoot's `meta` counts, get with messages, messages list and `POST` an outgoing reply attributed to the key's maker, `toggle_status`, `assignments`), contacts (list, get, a contact's conversations), inboxes (one, the site), agents, `/api/v1/profile`, and webhooks (list, create, update, delete) — every answer in Chatwoot's shapes (`message_type` 0 · 1 · 2 and its words, `content_type`, `meta.sender`, `meta.assignee`, `unread_count`, `additional_attributes`). No token is 401 and a key of another kind 403 in Chatwoot's error shape; the rate limit is the api module's.

#### Scenario: a guest through the Client API

- **WHEN** a client `POST`s a contact to the inbox, creates a conversation for it, posts a message, reads the messages, toggles typing and updates last seen
- **THEN** the contact is a guest of the desk (a `support_contacts` row under the token's hash, Guest in the inbox), the conversation opens on the desk's default prompt as the panel's does, the message is the contact's line, the acknowledgement follows as a system line (`message_type` 2), typing shows in the inbox, and a sixth guest from one address in an hour is refused as the widget's would be

Verified by: `build/support-api.test.mjs` on the demo and the root, the rows read back

#### Scenario: the desk through the Application API

- **WHEN** a key of kind support lists conversations by status, reads one, posts an outgoing message, resolves it, assigns it to an agent, lists contacts and agents, and reads the profile
- **THEN** the list is the inbox's (the counts `mine_count`, `unassigned_count`, `all_count` as Chatwoot counts them), the reply lands as the key's maker's line (`agent_id`, the inbox showing their initials), the status and the assignee change on the row, and the profile is the key's maker; no token 401, a content delivery key 403

Verified by: the test

### Requirement: Webhooks are delivered as Chatwoot delivers, for every write

A subscription (`url`, `subscriptions`: `conversation_created`, `conversation_status_changed`, `conversation_updated`, `message_created`, `contact_created`) made through the Application API SHALL receive Chatwoot's payload for every event whoever caused it — the widget, the inbox under RLS, the Client or Application API — the database telling the function of each insert and change, the function posting `{ event, … }` with the message (`message_type` as a word, `sender`, `conversation`, `inbox`, `account`) or the conversation; a failure kept on the subscription for the next event.

#### Scenario: a line from each side reaches the subscriber

- **WHEN** a subscription for `message_created` and `conversation_status_changed` exists and a contact writes through the Client API, the seed's support agent answers under RLS, and the thread is resolved through the Application API
- **THEN** a local receiver has three deliveries — an `incoming` message, an `outgoing` one and a status change — each with the conversation and the contact, and the subscription shows its last delivery

Verified by: the test with a local receiver

### Requirement: Chatwoot's snippet and `window.$chatwidget` work against the site

The site SHALL serve `/packs/js/sdk.js`: Chatwoot's website snippet with `baseUrl` set to the site and `websiteToken` the site's inbox identifier mounts the site's support widget — the launcher, the panel, the prompts, the guest token in the page's localStorage — on any page, with the site's design; and the page-side object SHALL be there, on the site's own pages too, as **`window.$chatwidget`** with **`window.$chatwoot` as an alias of the same object**: `toggle`, `toggleBubbleVisibility`, `popoutChatWindow`, `setUser`, `setCustomAttributes`, `setConversationCustomAttributes`, `reset`, `hasLoaded`, `isOpen`, and the events `chatwidget:ready` and `chatwidget:on-message` fired beside `chatwoot:ready` and `chatwoot:on-message`; a `websiteToken` that is not the site's refuses to run.

#### Scenario: the snippet on another origin

- **WHEN** Chatwoot's snippet with the site as `baseUrl` is put on a page of another local origin and the page calls `$chatwidget.toggle('open')`, then sends a line from the panel
- **THEN** the launcher stands in the corner, `chatwidget:ready` and `chatwoot:ready` have both fired, the panel opens, the line lands in the desk's tables as a guest's, and `$chatwoot.reset()` — the same object — drops the token

Verified by: the test on Playwright; the widget on the outside page screenshotted, both themes
