---
title: Membership
route: /pricing
seoTitle: Membership — Northlight Press
description: The first chapters are free. A membership opens every book and puts a coach in your chat.
sections:
  - component: Pricing
    props:
      eyebrow: Membership
      heading: Read for free. Join for the rest.
      lead: Every book's first chapters are open to anyone. A membership opens the rest, and the chat with a coach.
      featuredLabel: Most popular
      ctaCurrent: Subscribed
      ctaSwitch: Switch to this plan
      switched: 'You’re now on {name}.'
      ctaPending: 'Starts {date} · undo'
      switchedLater: 'You’re on {name} from {date}. Your current plan runs until then.'
      kept: 'You’re staying on {name}.'
      tiers:
        - name: Reader
          price: $0
          per: forever
          tagline: The first chapters of every book, and every article.
          features: ['The first chapters of every book', 'Every article, wiki page and guide', 'Support chat']
          cta: Start reading
          href: /content
        - name: Member
          price: $12
          per: month
          featured: true
          sku: member-monthly
          tagline: Every book in full, and a coach in your chat.
          features: ['Every book, every chapter', 'Chat with a coach, answered within 48 hours', 'The monthly members’ call']
          cta: Join
        - name: Patron
          price: $40
          per: month
          sku: patron-monthly
          tagline: Everything, and an hour with a coach every month.
          features: ['Everything in Member', 'A private hour with a coach each month', 'Chat answered within 24 hours', 'Each new book, the day it lands']
          cta: Join
      fine: Prices in US dollars. Cancel any time from your account.
  - component: Coaching
    props:
      eyebrow: One on one
      heading: What a session is.
      lead: An hour by video with a coach who has read the same books. Bring one real situation; leave with one thing to do this week.
      call:
        title: The Quiet Room · chapter two
        live: Live
        elapsed: '31:40'
        coach: Sam Rivera
        coachRole: Coach
        client: You
        clientRole: Member
        leave: Leave
      cta: Book a session
      href: /app/coaching
      fine: $60 on its own; included every month for Patrons.
  - component: Close
    props:
      heading: Questions? Ask in the chat.
      cta: Open the library
      href: /content
---
