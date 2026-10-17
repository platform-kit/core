---
title: Social automations
description: Configure staff-only, account-scoped bot replies to verified provider comments and DMs.
order: 50.1
sources:
  [
    packages/movable-types/src/components/admin/social,
    packages/movable-types/src/components/admin/SocialAdmin.vue,
    packages/movable-types/src/content/ui/social.md,
    packages/kit/supabase/functions/social,
    packages/kit/supabase/functions/social-webhook,
    packages/kit/supabase/functions/social-automation,
    packages/kit/supabase/functions/agent-run,
    packages/kit/supabase/functions/_shared/social,
    packages/kit/supabase/schemas/99-social.sql,
    packages/kit/build/modules/kit.mjs,
    packages/kit/build/test.mjs,
    packages/kit/build/social-automation.test.mjs,
    packages/kit/build/social-automation-db.test.mjs,
    packages/kit/build/social-automation-admin.test.mjs,
    packages/kit/build/social-webhooks.test.mjs,
    packages/kit/build/social-permissions.test.mjs,
    packages/kit/build/social-security.test.mjs,
    packages/kit/build/social-edge-runtime.test.mjs,
    packages/kit/supabase/functions/social-oauth,
    packages/kit/supabase/functions/social-publish,
  ]
reviewed: 2026-10-17
---

Social automations let authorized staff use a published bot to respond to supported incoming comments and direct messages. They are configured in **Social → Engage → Automations**, not in Spaces, and are never exposed to general app users. Both the records and the conversations stay behind Social's account-scoped staff permissions inside the application. The same Social area also connects external accounts and schedules posts to them.

## Connect accounts and publish posts

A publisher connects a supported account through the provider's authorization flow; the site keeps the credentials out of the browser and uses them only to manage that connected account. In the publishing calendar, staff can prepare a post for one or more eligible accounts and choose when it should go out. The available destinations and post options depend on what each provider supports.

A delivery is tracked for each account. The calendar distinguishes a post that was published, accepted for a provider-side schedule, waiting to retry, or blocked. Uncertain outcomes are not blindly resent: staff can see that the provider may already have accepted the post and resolve it without creating a duplicate.

## Access follows Social publisher permissions

An administrator has full access. An invited Social publisher needs **View results** on an account to read its rules, triggering interactions, response drafts and history. **Publish now** on that account is additionally required to create or change rules, enable or pause them, edit a draft, send a reviewed response or discard it. The Edge Function enforces these checks for every request; hiding controls in the browser is not the authorization boundary.

Automatic rules remember the publisher who authorized them. Before delivery, the worker rechecks that person's active Social access and current **Publish now** grant, along with the connected account and provider route. If any check fails, it pauses the rule without sending. An authorized publisher or administrator must explicitly reauthorize it.

## Build a rule from verified provider capabilities

Choose a connected account, an inbound **Comment** or **Direct message** event, a keyword or phrase, an eligible bot, one or more supported response destinations and a delivery mode. Matching is case-insensitive and requires a whole word or phrase; it does not match a longer word that merely contains the keyword. Repeated webhook delivery and events written by the connected account do not start duplicate bot responses.

The editor offers only routes the account can actually use: the adapter must verify and decode the inbound provider event and declare the needed read and write capabilities. There is no polling fallback. A comment may offer a **Public reply**, a **Private DM**, or both when that provider route supports both. A direct message can be answered only with a **Private DM**. If a route is unavailable or loses its capability, it cannot be enabled; disabling a rule remains possible so staff can stop automation.

Select a published bot that declares the Social surface and is eligible for an anonymous provider author. The provider's user id, handle or profile is not resolved to an app account. The bot receives the triggering text and only the available history from its own thread: the parent exchange for a comment when the provider exposes it, or recent messages from that DM conversation. The bot cannot choose a Social account, recipient or reply destination.

## Review or send automatically

A new rule starts in **Draft for review** mode. A matching event creates a separate response for every selected destination. In **Responses**, select a record to see its trigger, available same-conversation history, response text, delivery state and the destination's visibility. A publisher with **Publish now** can edit, send or discard a draft. The public/private badge is deliberately concise in lists; the selected detail explains who can see the message on the third-party platform.

Choose **Send automatically** only when the response is safe to publish or deliver without a person checking it. Future matches are sent only through the destination chosen in the rule; a public reply cannot become a private message or vice versa as a fallback. Delivery is tracked independently per destination. A definite failure is visible in history. An uncertain outcome is held without an automatic retry, because the provider may already have accepted the message; staff must resolve it deliberately rather than risk a duplicate.

Provider visibility is not app access: **Public reply** means people on that external social platform can see it; **Private DM** means only the recipient can. Inside the application, both the source event and generated response are restricted to Social publishers with account access.
