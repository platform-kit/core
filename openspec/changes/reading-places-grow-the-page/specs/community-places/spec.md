## ADDED Requirements

### Requirement: A place to read grows the page

A place registered in `community.places` SHALL accept `scroll`, either `frame` or `page`, defaulting to `frame`. A `frame` place SHALL fill the window under the site header and scroll inside it. A `page` place SHALL grow the page with its content, and on a wide screen the community's menu SHALL stay in view beside it as the page scrolls. The build SHALL refuse any other value.

#### Scenario: a page place

- **WHEN** a site registers a place with `scroll: 'page'` and a reader opens it
- **THEN** the document scrolls rather than a panel inside it, and the menu stays beside the content

Verified by: `packages/kit/build/network.test.mts` and a place driven in a browser

#### Scenario: a frame place

- **WHEN** a place is registered without `scroll`
- **THEN** it fills the window and scrolls inside, as before

Verified by: `packages/kit/build/network.test.mts`

#### Scenario: an unknown value

- **WHEN** a place is registered with `scroll: 'window'`
- **THEN** the build refuses it

Verified by: `packages/kit/build/network.test.mts`
