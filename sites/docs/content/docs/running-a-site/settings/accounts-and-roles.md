---
title: Accounts and roles
description: Find accounts, assign staff roles, and distinguish account, content, and staff access.
order: 41
sources:
  [
    packages/kit/build/who-can.test.mjs,
    packages/kit/build/signed-in-as.test.mjs,
    packages/kit/src/lib/auth.js,
    packages/kit/supabase/functions/_shared/permissions.js,
    packages/kit/build/permissions.test.mjs,
    packages/kit/build/permissions-db.test.mjs,
    packages/kit/build/site-permissions-node.mjs,
    packages/kit/src/lib/identity.js,
    packages/kit/build/identity-probe.mjs,
    packages/kit/src/lib/provider.js,
    packages/kit/src/lib/lockdown.js,
    packages/kit/theme/src/components/AuthModal.vue,
    packages/kit/supabase/seed.sql,
    packages/kit/supabase/schemas/10-foundation.sql,
    packages/kit/src/lib/auth-notices.js,
    packages/kit/supabase/functions/_shared/roles.ts,
    packages/kit/theme/src/components/admin/PeopleAdmin.vue,
    packages/kit/build/dev-account.mjs,
  ]
reviewed: 2026-10-27
---

Use **People → People** to find an account, review its purchases and bookings, and assign staff roles. A reader's access to paid content is separate from staff permissions; do not grant a staff role just to unlock a purchase.

## Who can do what, checked

Staff roles grant specific capabilities. Assign only the roles a person needs. A person can hold more than one role; only the `admin` role grants full administrative access.

## And the same question asked of the pages

Content access is separate from staff roles. A page or book may require a reader to be signed in, to have made a qualifying purchase, or to hold a live membership. Space roles and booking eligibility are separate again. A staff role does not automatically grant a paid membership or a space-specific role.

## Signing in

The sign-in form works for new and returning readers. It first tries to sign in with the submitted email and password. If that fails, the same form can create an account; an existing account with a wrong password receives the same sign-in error as any other failed attempt. Google and magic-link sign-in are available when enabled for the site. A feature that requires sign-in returns the reader to the page where they started.

Use **Forgot your password?** below the password field to request a reset email. The reset link returns to the site and opens the new-password form.

## The confirmed address

New readers can use the site before confirming their address. The site sends a confirmation link after sign-up; selecting it marks the address as verified. Features that rely on a reachable email—such as reading results or support replies by email—may require confirmation. Google sign-ins arrive verified.

## Classes and access

Content gates use these reader classes:

| Class             | Meaning                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------- |
| **guest**         | Not signed in.                                                                          |
| **authenticated** | Signed in, whether or not the reader has purchased or subscribed.                       |
| **paid**          | Has made a purchase that qualifies for the specific gated content.                      |
| **subscribed**    | Has a live membership. A paid session separately grants a week of coaching-chat access. |

Higher classes include the access of lower classes. A printed copy or file does not, by itself, unlock a book online; only the book's online offer does. A guest purchase is claimed by an account with the same email address once that account proves it owns the address, by signing in through the emailed link or with a provider. Until then the purchase stays with the address, so somebody who signs up with another person's address gets nothing of theirs.

## Staff roles

Roles are additive. A person may hold more than one:

| Role         | Access                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **admin**    | All administrative capabilities. The last administrator cannot be removed or demoted.                                                              |
| **editor**   | Read, edit, and publish content.                                                                                                                   |
| **provider** | Sell and schedule offerings. This role also identifies providers for coaching features. Older accounts with the `coach` role are still recognized. |
| **support**  | Read, answer, assign, and resolve support conversations; read contact records.                                                                     |
| **analyst**  | Read analytics and other figures.                                                                                                                  |

A social publisher's invitation is not a staff role. Accepting it grants access to the Social area only; an administrator separately assigns that publisher's actions for each connected account.

## People → People is every account, not only the staff

Search by name, email, or username. Filter the list to all accounts, staff, providers, members, purchasers, or unconfirmed email addresses. The list is paginated. Open a person to review:

| Information  | Details                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------- |
| Roles        | Current staff roles, shown as switches. This is the only information you can change here. |
| Entitlements | Live access grants and their source or expiry.                                            |
| Purchases    | Purchases and refunds, including amounts.                                                 |
| Subscription | Current plan and status, paid-through date, and any scheduled plan change.                |
| Bookings     | Past and upcoming sessions.                                                               |
| Invoices     | A link to that customer's Stripe record when a Stripe billing id is available.            |
| Traits       | The traits configured for staff review.                                                   |

Use the role switches on this page to assign or remove staff roles. People is read-only for profile, membership, and purchase data; it does not expose payment-card or bank details. The last administrator cannot be demoted or removed.

### What each of them sees of the admin

The admin filters its navigation by role. The sections available also depend on the site's enabled modules and deployment mode. If a section is missing, check those settings as well as the assigned role. A visible link—or a route opened directly—does not bypass the server's permission checks.

## What to call the person who delivers what the site sells

The role identifier is `provider`; readers and staff see the site's configured wording. Set the provider labels in **UI strings → people → role → provider**. Update the `name`, `plural`, `a`, `your`, `work`, and `session` fields together so lists, links, and labels use the same term. This changes display copy, not permissions. An individual provider may also set a title on their profile, which takes precedence where their name is shown.

## When somebody arrives, and when they leave

Account-specific data is loaded after sign-in and cleared at sign-out. If the page still shows the previous account after switching users, refresh before continuing.

### Two halves, and both of them register

Community access can depend on a person's role or grant in a particular space. Assigning a staff role does not add someone to a space or grant a space capability.

## Start over

On a site with a diagnostic, **Start over** at the foot of the Diagnostics page removes the reader's answers and readings, both locally and from their account. It leaves books, personal highlights, and trophies intact.

## The test accounts

A development database is seeded with `admin@example.com`, `coach@example.com`, `support@example.com`, `editor@example.com`, `analyst@example.com`, and `writer@example.com` (provider and editor), plus member, purchaser, and free-reader accounts. The shared local password is `password123`. These are for local development only; do not use them on a live site or replace them with real people's addresses. Resetting the local database restores the seed and removes local changes, including accounts created during testing.

## Lockdown

LOCKDOWN_MODE is for a site that is not yet open to readers. It refuses new reader sign-ins and signs out non-staff accounts while leaving staff able to work. Keep it off for a public launch. The support widget also undoes a reader sign-in while lockdown is active.

## What a profile holds

A profile can hold a username and page at `/p/<username>`, display and legal names, a picture or avatar settings, a short bio, a public-profile setting, and notification preferences. Public profiles are off until the person enables them. People edit their own profile at `/p`; staff cannot publish or rewrite a profile on somebody else's behalf.

## What may be done, in one place

Access checks consider the relevant fact for the action: sign-in status, a qualifying purchase, a live membership, a staff role, or a space-specific grant. The server checks permissions when an action is requested. If someone can see a page but cannot complete an action, check that action's requirement rather than adding an unrelated staff role.
