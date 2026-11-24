# Proposal

## Why

A site chooses its heading font in the admin (`content/site.md` `fonts.heading`), and the build writes it as the `--fd` token. The base heading rule never named that token, so any heading without a rule of its own fell through to the body font and stayed there whatever the site chose; a few rules named the body font on purpose. On DharmaLab that left the landing page's section headings, the pricing heading, the application title, the content hub's headings, the community Home's cards and the billing page in the body font while the rest of the site's headings were in the heading font.

## What Changes

- The base `h1`–`h4` rule takes `--fd`, so every heading follows the font set in the admin, and changing it there changes every heading.
- The kit's heading rules that named the body font (the billing page's titles, the usage panel's sections) take `--fd` too.
- A test fails the base rule if it stops naming `--fd`, and fails any heading rule in the kit that names a font of its own or the body's token. A heading may still use the mono token (a label set as a heading).

## Capabilities

### New Capabilities

- `headings-in-the-heading-face`: every heading follows the site's heading font.
