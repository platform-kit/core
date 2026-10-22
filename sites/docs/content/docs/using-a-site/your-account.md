---
title: Your account, membership and purchases
description: Find what your account saves, how memberships and purchases work, and where to manage files, orders, coaching, and support.
order: 31
sources:
  [
    packages/kit/theme/src/components/AuthModal.vue,
    packages/kit/theme/src/pages/BillingPortalPage.vue,
    packages/kit/theme/src/pages/SignInPage.vue,
    packages/kit/theme/src/components/store/ProductPage.vue,
    packages/kit/src/lib/downloads.js,
    packages/kit/src/lib/booking.js,
  ]
reviewed: 2026-10-15
---

## An account

An account keeps your place in books, your personal highlights, quiz results and trophies, and purchases. Sign in with an email and password, Google, or a magic link if the site offers those options. When a feature asks you to sign in, it returns you to the page where you started; the return address must belong to the same site.

A new account can sign in immediately. The site also sends a confirmation link to the email address. Some features—such as seeing reading results or receiving a support reply by email—require a confirmed address. Select the link in that email to confirm it.

The Billing page is separate from Your account. It shows membership and payment details; its Usage view appears only on sites with a published metered subscription. If you arrive signed out, sign in before your details appear. The reusable full-page sign-in layout has no contextual copy or artwork by default. Each route can supply a `copy` object (`eyebrow`, `title`, and `description`) and an optional `art` slot. Billing supplies route-specific sign-in copy and no artwork. The page offers the options configured for that site and includes password recovery.

Your account menu opens **Your account**, where you can choose an avatar style or upload your own picture. The picture you choose replaces the generated avatar. To create or edit a public profile page, see [A person's own page](/content/docs/running-a-site/community/people-and-profiles).

## A membership

A membership gives access to the content, chat, or sessions included by that site's membership rules. Review the site's pricing page for the available tiers and included benefits. Join from the pricing page or store. To update your payment method or cancel, choose **Manage membership** from the account menu. Switching to a higher plan takes effect immediately and charges the prorated difference; switching to a lower plan takes effect at renewal.

## Buying a book

On a book's store page, choose **Read online**, a printed format, or an available PDF/EPUB download. Printed formats may offer a choice of contents; some hardcovers also let you choose cloth and foil. Select the destination country before choosing shipping. The page then shows the available shipping methods and prices.

You can buy a printed copy or a file without an account. Checkout asks for an email address. If you later create an account using that same address, the purchase is attached to it. Buying a printed copy or download does not unlock the online book; that requires the separate online offer.

## Your files and orders

If your purchase includes files, open the book's store page or its cover page in the reader and choose **Your files**. Links are generated when requested and expire, so request a fresh link if an old one no longer opens. Your order confirmation arrives by email; a shipping update with tracking follows when the parcel ships. The printer sends the parcel to the address entered at checkout.

## Coaching

Open the app's **Coaching** tab to see sessions you can book, your remaining weekly or monthly allowance, and when a used allowance becomes available again. Choose a date and time, review the details, then confirm. Signed-out visitors can view public session types and availability at `/community/coaching`; personal bookings and chat require sign-in. Some sites require sign-in before booking; others allow eligible session types to be booked as a guest. You can move or cancel an upcoming booking from its row when those actions are available.

The **Chat** tab is the conversation with coaches. Membership access varies by site; a paid session also includes a week of chat after the session.

## Getting help

Select the support-chat launcher in the page corner to contact the support desk. You can start as a guest. Sign in and confirm your email if you want the desk's reply to be reachable by email.
