## ADDED Requirements

### Requirement: Every heading follows the site's heading font

Every heading SHALL be drawn in the font the site sets as its heading font, through the `--fd` token, so that changing the font in the admin changes every heading. A heading rule in the kit SHALL NOT name a font of its own or the body's token; it MAY use the mono token.

#### Scenario: the heading font changes

- **WHEN** the site's heading font is changed
- **THEN** every heading on the landing page, the pricing and application pages, the content hub, the community and the billing page is drawn in the new font

Verified by: `packages/kit/build/heading-face.test.mts`, and the token swapped in a browser on ten pages with every heading following it
