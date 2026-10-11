---
title: Northlight Brochure
route: /
description: The smallest site the kit can make — a few pieces of writing, no backend, and nothing switched on that needs one.
sections:
  - component: Hero
    props:
      eyebrow: A brochure
      lines: ['The smallest site', 'this kit makes.']
      sub: No database, no accounts, no store. A few pieces of writing, a wiki, and a palette the theme supplied. It is here to prove that a site with none of the machinery still renders, still reads, and still looks like something.
      fine: No backend anywhere in it.
      cta: Read the writing
      href: /content
  - component: Features
    props:
      eyebrow: What it has
      heading: Three things and no more.
      items:
        - { title: Writing, body: 'A couple of articles, built from markdown and nothing else.' }
        - { title: A wiki, body: 'The same content engine, arranged as a tree instead of a feed.' }
        - { title: A palette, body: 'None of its own — it wears the theme''s, which is the point.' }
  - component: Close
    props:
      heading: That is the whole site.
      cta: Start reading
      href: /content
---

The brochure fixture: a site with `backend: false`, no landing page of its own until now, and no
look. The static lane builds it, serves it and walks every route with the console and the network
watched — a request to a backend is a failure, which is the only thing that catches a component
that stopped guarding `configured`.
