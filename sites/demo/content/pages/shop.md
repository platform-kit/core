---
title: The shop, every way
route: /shop
seoTitle: The shop, every way — Northlight Press
description: A commerce landing page built from the page builder's store sections — an announcement, a spotlight, the shelf, the collections, a drop with a countdown, and the rest.
progress: true
sections:
  - component: Announcement
    props:
      badge: Autumn
      text: The autumn list is out — **two new books**, free shipping over $40 with the code below.
      cta: See the list
      href: /store
      code: AUTUMN
      dismiss: true
  - component: Hero
    props:
      layout: split
      tone: paper
      glow: visual
      eyebrow: The shop
      lines: ['Books that fit', 'in a ^^coat pocket^^.']
      sub: Short, practical, printed in small runs. Every copy comes with the e-book, and the first chapter is free to read online.
      cta: Shop the books
      href: /store
      cta2: Read a chapter first
      href2: /content
      arrive: words
      arrow: true
      visual:
        kind: image
        image: /img/store/books.webp
        alt: The four books, stacked
      rating:
        stars: 4.9
        line: '**4.9** from 1,200 readers'
      floats:
        - kind: stat
          at: tl
          value: '12,000+'
          line: copies sold
        - kind: chat
          at: br
          title: Mara, Oslo
          line: '"Finished it on the train. Then read it again."'
  - component: Perks
    props:
      layout: strip
      tone: wash
      items:
        - icon: globe
          title: Ships worldwide
          body: From $5
        - icon: lock
          title: Secure payment
          body: Cards and wallets
        - icon: clock
          title: 30 days to return
          body: No questions asked
        - icon: gift
          title: Gift wrapping
          body: On request
  - component: Collections
    props:
      eyebrow: Shop by kind
      heading: Two shelves.
      layout: tiles
      cta: See everything
      href: /store
  - component: Spotlight
    props:
      anchor: notebook
      eyebrow: New this season
      heading: One line a day.
      sku: notebook
      side: left
      body: One line a day, for a year. A page for every morning, a ribbon, and a cover that will take a coffee ring without complaint. **Made in a run of 500.**
      points:
        - icon: leaf
          text: 368 pages of 100gsm paper
        - icon: book
          text: Lies flat when open
        - icon: sun
          text: The first hour, explained on the inside cover
      trust:
        - icon: globe
          text: Ships worldwide
        - icon: lock
          text: Secure payment
        - icon: clock
          text: 30 days to return
      compare: '$24'
      until: '2026-10-01T09:00'
      stock:
        left: '112'
        total: '500'
      cta: Add to bag
  - component: Products
    props:
      tone: paper
      eyebrow: The shelf
      heading: In print now.
      source: collection
      collection: books
      layout: cards
      columns: 4
      cta: Everything in the store
      href: /store
  - component: Countdown
    props:
      tone: ink
      glow: corner
      eyebrow: The drop
      heading: The winter list arrives in
      lead: Four titles, one run of each. When they are gone, they are gone.
      until: '2026-12-01T09:00'
      layout: centered
      cta: Tell me when
      href: /shop#newsletter
      over: It is here.
  - component: Products
    props:
      eyebrow: For the desk
      heading: And the things beside the books.
      source: collection
      collection: goods
      layout: rail
      cta: All goods
      href: /store
  - component: Testimonials
    props:
      tone: wash
      eyebrow: What readers say
      heading: Short, and read whole.
      layout: one
      items:
        - quote: "I have started a hundred books this year and **finished four**. All four were Northlight's."
          name: Mara Lindqvist
          role: Reads on the train
          stars: 5
        - quote: The notebook is the first I have kept past January. **One line** is the trick.
          name: Tom Okafor
          role: Keeps a notebook now
          stars: 5
        - quote: Arrived in two days, wrapped in paper. The book was **better than the wrapping**, which is saying something.
          name: June Park
          role: Bought three as gifts
          stars: 5
  - component: Tabs
    props:
      eyebrow: The particulars
      heading: Before you buy.
      variant: pills
      items:
        - label: The books
          icon: book
          body: Every book is 6 by 9 inches, 60 to 120 pages, printed on cream paper and bound to open flat. Each comes with the e-book, in PDF and EPUB, the moment you pay.
        - label: Shipping
          icon: globe
          body: We ship worldwide from the press. $5 in the US, $15 elsewhere, free over $40. Two to five days at home, a week or two abroad.
        - label: Returns
          icon: undo
          body: Thirty days, no questions. Send it back in any condition and we refund the book; if the fault is ours, the shipping too.
  - component: Cta
    props:
      layout: promo
      image: /img/store/print.webp
      alt: A book on the press
      heading: Buy two, and the third is half price.
      lead: On any three books in print, at the bag — nothing to enter.
      from: From $5 a book
      cta: Shop the books
      href: /store
  - component: Newsletter
    props:
      anchor: newsletter
      layout: card
      heading: Hear when the next run lands.
      lead: One email a season, and the code for free shipping.
      form: newsletter
      name: true
      button: Keep me posted
      fine: No more than four a year.
  - component: Footer
    props:
      layout: mega
      about: A small press for short, practical books, printed in small runs in the north.
      call:
        heading: Every book, in print and on the page.
        cta: Shop the books
        href: /store
      columns:
        - title: Shop
          links:
            - label: The books
              href: /store
            - label: For the desk
              href: /store/collections/goods
            - label: Membership
              href: /pricing
        - title: Read
          links:
            - label: The library
              href: /content
            - label: Articles
              href: /content/articles
        - title: The press
          links:
            - label: About
              href: /about
            - label: Contact
              href: /about#contact
      capture:
        heading: The seasonal letter
        form: newsletter
        button: Join
      social:
        - label: Instagram
          href: https://instagram.com
        - label: X
          href: https://x.com
        - label: Mail
          href: mailto:hello@example.com
      legal: © {year} Northlight Press. All rights reserved.
      small:
        - label: Privacy
          href: /privacy
        - label: Terms
          href: /terms
---
