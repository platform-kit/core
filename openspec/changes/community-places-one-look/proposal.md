# Proposal

## Why

The community's places were each drawn to their own measure. The course used white cards and a 50px title, Home used outlined cards on the page's ground, the sessions a tinted card with a shadow, the diagnostics white cards and a 45px title; each had its own padding, and only the sessions used the site's heading face. Moving from one place to the next felt like moving between products. The booking screen was the one judged right, so it sets the measure.

## What Changes

- The community page defines the measure once: the page's width (1040px) and padding (32px, 16px on a phone), the card's ground (the ink at 2.5% on the paper), edge, 18px corner and shadow, the gap between cards, and the title's face (the site's heading font) and size.
- Home, the Courses place, Sessions and a site's own places read it, so every place starts at the same point with the same title and the same cards, in light and dark and on a phone.
- A page outside the community (the standalone course pages, the results sheet at its own address) keeps its own look.
- Every page in the community has the same frame: a page with nothing open beside it (no thread, card or search, and a sidebar with nothing coming up) takes the column and the sidebar's place together, so moving from Home to a space, a post, People, Explore or Browse spaces never narrows the page; a thread or card open beside it shares the same frame. A space's head and feed, a post's page and Explore start at the same left edge as the places.
- The Courses place keeps its padding however it is reached (arriving through `/courses` lost it).

## Capabilities

### New Capabilities

- `community-places-one-look`: every community place drawn to one measure.
