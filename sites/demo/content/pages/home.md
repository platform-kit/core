---
title: Home
route: /
seoTitle: Northlight Press — short books, read whole
description: A small press for short, practical books on attention, craft and rest — read online chapter by chapter, kept as a member, printed for the shelf.
sections:
  - component: Hero
    props:
      lines: ['Short books.', 'Read whole.', 'Kept for good.']
      sub: Northlight publishes books you can finish in an evening and use for a year — on attention, craft and rest. Read the first chapters free, open the rest as a member, or keep a copy on the shelf.
      cta: Browse the library
      href: /content
      fine: No account needed for the first chapters.
      cta2: See the pricing
      href2: /pricing
      visual:
        kind: frame
        image: /img/pages/app-library.webp
        alt: The library page — four books on the shelf, and the articles under them
  - component: Marquee
    props:
      benefits: [Finish a book in an evening, Every chapter summarised, A quiz per chapter, Highlights kept, Read on any device, Ask a coach]
      qualifiers: [First chapters free, Printed on demand, Ships worldwide, PDF & EPUB included, Runs of 500, Yours to keep]
  - component: How
    props:
      eyebrow: How it works
      heading: Read a chapter. Keep what you learned. Come back tomorrow.
      steps:
        - title: Read, or read the short version
          icon: doc
          tag: Step one
          body: Every chapter has a companion beside it — a summary that loses nothing, and the two or three ideas to keep. Switch between the two with one tap.
        - title: Test yourself
          icon: sun
          tag: Step two
          body: Five questions close each chapter. Pass four and the chapter is yours; bronze for the first, silver at halfway, gold for the whole book.
        - title: Keep it
          icon: bars
          tag: Step three
          body: Your highlights, your place and your trophies follow you to any device. Members open every chapter; a printed copy comes with the files.
  - component: Library
    props:
      eyebrow: The library
      heading: Four books, and more each season.
      lead: Each one is short on purpose — long enough to change a habit, short enough to be finished — and comes with its companion and its quiz.
      book: working-hours
      chapter: The first hour
      formats:
        - title: Full text
          body: The whole chapter as the author wrote it
        - title: Summary
          body: The same chapter in a hundred and fifty words
        - title: Audiobook
          body: Every chapter read aloud, where a recording exists
      extras:
        - title: Highlights
          body: The lines worth noticing, marked in the text
          icon: highlight
        - title: Quiz
          body: Five questions at the end of every chapter
          icon: note
        - title: Bookmarks
          body: Your place, on every device you sign in to
          icon: bookmark
      cta: Open the library
      href: /content/books
  - component: Creator
    props:
      eyebrow: The press
      heading: Edited by one person, on purpose.
      name: The press
      role: Since 2024
      image: /img/pages/editor.webp
      statement: 'Northlight exists because the books worth giving people were too long to give. Every title is edited down to what a busy reader will actually finish — *and then read again*. If a chapter cannot be summarised in a hundred and fifty words, it goes back to its author.'
      facts:
        - { label: Founded, body: '2024, in a spare room' }
        - { label: Books, body: 'Four in print, three in edit' }
        - { label: Rule, body: 'Nothing over a hundred pages' }
      cta: About the press
      href: /about
  - component: Coaching
    props:
      eyebrow: One on one
      heading: Talk it through with a coach.
      lead: Members can bring a chapter and a real situation to a coach — one hour, by video — and keep the conversation going in chat between calls.
      call:
        title: Working Hours · chapter one
        live: Live
        elapsed: '12:04'
        coach: Sam Rivera
        coachRole: Coach
        client: You
        clientRole: Member
        leave: Leave
      cta: See the membership
      href: /pricing
      fine: A session is included with the Patron plan, and bookable on its own.
  - component: Pricing
    props:
      eyebrow: Membership
      heading: Read for free. Join for the rest.
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
  - component: Close
    props:
      heading: Ready to start reading?
      cta: Open the library
      href: /content
---
