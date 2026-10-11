---

tags: [publishing]
title: Why we the
description: 'Files are easier to keep than databases, and a build step can do what a CMS does.'
date: 2026-09-01
author: Maren Ekholm
published: true
image: /img/articles/markdown.webp
---

Every page on this site is a file in a folder. An article is a markdown file with a few lines of frontmatter; a book is a longer one, split at its chapter headings; a product is a file that names a price.

The build reads them all, checks each against a schema, and writes the site — pages, a search index, share images, a sitemap. Nothing is typed into a form that only a database remembers.

## What that buys you

- Every change is a commit, with a diff and an author.
- The whole site can be rebuilt from the folder on any machine.
- An editor with a text editor can do everything the admin can.

## What it costs

A little discipline. A frontmatter field spelled wrong fails the build instead of silently breaking a page — which is the point, but takes getting used to. And pictures live beside the words, so a folder is heavier than a database row. We think both are the right trade.
