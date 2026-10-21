# Proposal

## Why

A member's card has a private half, seen only by that person and staff. The kit leaves it empty unless a site writes panels for it, and the only panels written are DharmaLab's: what somebody has read, has bought, and where the diagnostic placed them. Every fact they show is the kit's own, so every other site, the demo included, shows an empty half. Profiles in the products the kit replaces show a member's activity, and staff their orders, as a matter of course.

## What Changes

- The kit ships three panels, each drawn only where its module is on:
  - **Read** (library and analytics): books and articles opened, most recent first.
  - **Bought** (store): paid purchases, newest first.
  - **Working** (instrument): where the diagnostic placed them, levels named from the site's own instrument vocabulary.
- Each asks the kit's existing rule (that person, or staff) before reading.
- A site rewords them through its strings, turns any off, adds its own, and sets the order.
- **Bought** and the admin's person page read purchases from one source.
- **BREAKING for DharmaLab:** its panels become the kit's. It deletes its copies and keeps its wording as string overrides.

### The theme's default words

Each title has a form for your own card and for somebody else's, and each panel has an empty sentence:

> Where they are working · Where you are working · secure at {name} · {n} areas taken · They have not taken a diagnostic yet. · You have not taken a diagnostic yet.
>
> What they have read · What you have read · They have not opened a book or an article yet. · You have not opened a book or an article yet.
>
> What they have bought · What you have bought · They have bought nothing yet. · You have bought nothing yet.

## Non-goals

- Recording anything new: the panels read what the library, store and instrument already keep.
- Showing any of it to other members.
- Moving the instrument's scoring into the kit.

## Review focus

The module gates (Working especially), the shared purchase source, and DharmaLab's cards unchanged after it deletes its copies.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kit-extension-model`: "A site registers what a member's card says about somebody" changes from the kit knowing nothing of read, scored or bought to the kit shipping these panels per module, worded and switchable by the site. Its scenario naming "those three", one site's panels in a kit specification, is corrected.

## Impact

- Surfaces: the community member card (both themes, phone and desktop) and the admin person page.
- Kit and theme: three panels, their data reads, module gates, theme strings.
- Demo: cards gain Read and Bought.
- DharmaLab (its own repository): deletes its panels, keeps its words.
- Docs: the extension model and community pages.
