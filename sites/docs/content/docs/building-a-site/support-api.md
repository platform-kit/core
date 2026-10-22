---
title: The Support API, Chatwoot's
description: The support desk served as Chatwoot's Client and Application APIs with webhooks, Chatwoot's website snippet mounting the site's widget on any page, and window.$chatwidget; the guide. The reference lists every route and field.
order: 56.98
sources:
  [
    packages/kit/supabase/functions/support-api,
    packages/kit/supabase/functions/_shared/support.ts,
    packages/kit/supabase/functions/_shared/api/chatwoot,
    packages/kit/src/lib/support/chat-widget.js,
    packages/kit/src/lib/chat/recorder-light.js,
    packages/kit/theme/src/support-embed.js,
    packages/kit/theme/src/pages/SupportPage.vue,
    packages/kit/src/lib/interrupt.js,
    packages/kit/build/support-sdk.mjs,
    packages/kit/build/steps/support-sdk.mjs,
    packages/kit/build/interrupt.test.mjs,
    packages/kit/build/support-api.test.mjs,
  ]
reviewed: 2026-10-21
---

## What it is

A site with the support and api modules on serves its desk the way **Chatwoot** serves one: the **Client API** (the widget's own door — a contact, its conversations and messages, typing, last seen), the **Application API** (the desk's — conversations, replies, status, assignments, contacts, agents, webhooks) and **webhooks** delivered with Chatwoot's payloads, at Chatwoot's paths; and Chatwoot's **website snippet** with `baseUrl` set to the site mounts the site's own support widget on any page, with `window.$chatwidget` on it — and `window.$chatwoot` as an alias of the same object, so pages written for Chatwoot drive it unchanged. The desk was built Chatwoot-style on purpose, and Chatwoot is open source where Intercom and Crisp cannot be pointed elsewhere — so a helpdesk tool, a Slack bridge, a CRM sync or a bot written for Chatwoot works with the base changed. The reference — every route, field and error — is [The Support API reference](/content/docs/reference/support-api).

```html
<script>
  ;(function (d, t) {
    var BASE_URL = 'https://northlight.example.com'
    var g = d.createElement(t),
      s = d.getElementsByTagName(t)[0]
    g.src = BASE_URL + '/api/desk/packs/js/sdk.js'
    g.defer = true
    g.async = true
    s.parentNode.insertBefore(g, s)
    g.onload = function () {
      window.chatwootSDK.run({ websiteToken: 'northlight-press', baseUrl: BASE_URL })
    }
  })(document, 'script')
</script>
```

```js
// the desk, from a script — a key of kind support
const r = await fetch(
  'https://northlight.example.com/api/desk/api/v1/accounts/1/conversations?status=open',
  { headers: { api_access_token: '<a support key>' } },
)
const {
  data: { meta, payload },
} = await r.json()
await fetch(
  `https://northlight.example.com/api/desk/api/v1/accounts/1/conversations/${payload[0].id}/messages`,
  {
    method: 'POST',
    headers: { api_access_token: '<a support key>', 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'On its way.', message_type: 'outgoing' }),
  },
)
```

## The Client API is the widget's door

`/api/desk/public/api/desk/api/v1/inboxes/<inbox>/…` takes no key, as Chatwoot's does not: the inbox identifier is the site's space id (Settings → API shows it as the Space; the Application API's `inboxes` answers it as `website_token`). `POST …/contacts` makes a **guest** of the desk — a new token, answered as `source_id`, which every later call names — under the same guards as the widget (five new guests, eight new threads an hour from one address). Identity is the account: a name or an address given here is kept as **custom attributes**, never as who they are, and the inbox shows them under the contact's card; a contact that is an account's is not opened here (the site's sign-in is), so the Client API's contacts are guests, exactly as the widget's are. `…/conversations` `POST` opens a thread on the desk's default prompt as the panel does; `…/messages` `POST` is the contact's line (the acknowledgement follows once, as an activity line; `echo_id` comes back); `toggle_typing`, `update_last_seen` and `toggle_status` are the widget's typing, read and resolve. A conversation's `pubsub_token` is the thread's own realtime topic key (`support:<key>`, the site's realtime rather than ActionCable); polling stays the fallback.

## The Application API is the inbox

`/api/desk/api/v1/accounts/<any>/…` under a key of kind **Support** (Settings → API: _the desk: conversations, replies, contacts, webhooks_), sent as `api_access_token` (a bearer works). Everything is attributed to the key's maker: a `POST …/messages` reply lands as their line — the inbox shows their initials, the contact is told as for any reply — and the key's maker must be on the desk (admin or support). The conversations list takes `status` (open, pending, resolved, all) and `assignee_type` (me, unassigned, all) with Chatwoot's counts in `data.meta`; a conversation carries its `meta.sender` (the contact, with `additional_attributes.kind` guest · user · customer), `meta.assignee`, `unread_count`, `waiting_since` and its messages; `toggle_status` and `assignments` change the row as the inbox's buttons do; `contacts`, `agents`, `inboxes` and `/api/desk/api/v1/profile` say who is who. Ids are the rows' uuids where Chatwoot's are integers — a client that parses an id as a number is the one thing that breaks.

## Webhooks, for every write

A subscription (`POST …/webhooks` with `url` and `subscriptions`) receives Chatwoot's payload for every event named — `conversation_created`, `conversation_status_changed`, `conversation_updated`, `message_created`, `contact_created` — **whoever caused it**: the widget's function, the inbox under RLS, the Client or Application API. Triggers on the three tables tell the `support-api` function (`support_api_notify` over pg_net, the service secret), and the function posts `{ event, … }` — a message with `message_type` as a word (`incoming`, `outgoing`, `activity`), its `sender`, the `conversation`, the `inbox` and `account` — to every subscription holding the event; a failure is kept on the subscription (`last_error`) for the next.

## The snippet, and `window.$chatwidget`

`/api/desk/packs/js/sdk.js` (built by `build/support-sdk.mjs` into `dist/`, or `PLATFORMKIT_DIST`) is the site's support widget built for another origin — the launcher, the panel, the prompts, a guest's token in that page's own localStorage, the site's design tokens with it — the way `form.js` is the form embed (`build/support-sdk.mjs`, the `support-sdk` step: the light store in place of the CRDT one, the words cut to the widget's scopes, no voice recorder off the site). The lightweight content and recorder substitutions apply only to support components; the site’s other components retain their full APIs during this build. The embed substitutes a small `#site` module with public site metadata, module switches and keys, plus data-only community claims for routing; its `#site/routes` table is empty, so the bundle carries no registered page components. The widget still observes the host page's current URL. `#site/looks` still brings in the active look. It carries the design with it — the theme's tokens (`src/tokens.css`) and the site's look — so the widget looks on another page as it does at home, and anything of the site's that a prompt names (a picture under `/uploads/`) is fetched from the site, not from the page carrying the widget: `run`'s `baseUrl`, or the script's own address, is where those paths resolve. `window.chatwootSDK.run({ websiteToken, baseUrl })` mounts it; `websiteToken` must be the site's inbox identifier, and anything else refuses to run with a line in the console. `window.$chatwidget` is installed as the widget mounts — on the site's own pages too — and **`window.$chatwoot` is an alias of the same object** (not a copy: either name drives one widget): `toggle('open' | 'close')`, `toggleBubbleVisibility('hide' | 'show')`, `popoutChatWindow()` (the panel on a page of its own, `/support`), `setUser` / `setCustomAttributes` / `deleteCustomAttribute` (kept as the contact's custom attributes through the Client API once the contact exists), `setConversationCustomAttributes`, `reset()` (the guest token dropped), `hasLoaded`, `isOpen`; the events `chatwidget:ready` (once the widget has booted) and `chatwidget:on-message` (a line landing in the open thread), each fired under Chatwoot's name beside ours (`chatwoot:ready`, `chatwoot:on-message`), so a page listening for either hears it. On another origin the site's sign-in is not on the page, so the panel offers none: a contact there is a guest.

The site-wide launcher follows the shared interruption policy and stays off checkout pages so it cannot cover payment-entry controls.

## The address

Two rewrites beside the others: `/api/desk/public/*` → the `support-api` function, and `/api/desk/api/v1/*` — Chatwoot's Application API — rides the Store API's `/api/*` rule and is handed on whole by the `storefront-api` function (a host's rewrite is a prefix, and one prefix goes to one function); the [hosting page](/content/docs/building-a-site/dev-build-and-deploy) has the file. Where the host has no rewrite the shell forwards both paths to the function; its own address answers too. The reference at `/api` carries the Support API as a group (Client, Conversations, Contacts, Support Webhooks).

## Where the shapes are, and what checks them

The contact's side is the `support` function's own helpers, factored into `_shared/support.ts` (the resolution, the guards, the threads, the acknowledgement, the escalation), so both doors are one desk; `_shared/api/chatwoot/shapes.js` is Chatwoot's shapes over the rows (a message, a conversation, a contact, an agent, the inbox, the webhook payloads). `build/support-api.test.mjs` (in `platformkit test` with support and api on; `SUPPORT_API_TEST=0` skips it) pins the shapes under Node and — with the stack up — a guest's life through the Client API, the desk through the Application API, the refusals, the webhooks with a local receiver (a contact's line, an agent's under RLS, a status change), the guards; on Playwright, Chatwoot's snippet on a page of another origin (`chatwoot:ready`, `$chatwoot.toggle`, a line sent, `setCustomAttributes`, `reset`, a wrong token refused; `SUPPORT_API_SHOTS` a directory for its screenshots).

## What is not there, on purpose

Chatwoot's identity validation (`identifier_hash`): a signed-in person is the site's own sign-in; teams, labels (accepted, not kept), macros, automation rules, campaigns, reports, CSAT, the agent bot API, articles; ActionCable; private notes through the API (the note on the contact is the desk's, under RLS).
