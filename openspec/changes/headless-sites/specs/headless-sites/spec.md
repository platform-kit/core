## ADDED Requirements

### Requirement: A headless site builds every interface except its reader pages

Every route SHALL be marked `reader`, `staff`, `developer`, `embed` or `hosted`. A site that sets `headless: true` SHALL build and deploy its database, backend functions and APIs; every route not marked `reader` (the admin, the API reference at `/api`, the pages other websites embed, and the pages a front end sends people to, such as checkout and video calls); and the scripts other websites load. It SHALL emit no `reader` page, prerendered page, sitemap entry or share image. Its root address SHALL show only a notice naming the site and linking to `/admin` and `/api`. `platformkit dev` SHALL serve the same set. `headless` SHALL be refused with `deployment: static`, since a static site has no backend.

#### Scenario: the demo built headless

- **WHEN** a copy of the demo is built with `headless: true` and every module that answers `false` switched off
- **THEN** no reader page is emitted; `/admin`, `/api`, every embed and hosted page, and the support and analytics scripts are; and `/` serves the notice

Verified by: `build/headless.test.mjs`

#### Scenario: static and headless together

- **WHEN** a site sets `headless: true` with `deployment: static`
- **THEN** the build refuses it, saying a static site has no backend to serve

Verified by: `build/headless.test.mjs`

#### Scenario: a route with no mark

- **WHEN** a kit, theme or site route has no mark
- **THEN** the build refuses it, naming the route

Verified by: `build/manifests.test.mjs`

### Requirement: A headless site's functions answer only its own front ends

A headless site SHALL name the origins of its front ends in `headless.origins`. Every backend function and API SHALL accept cross-origin requests from those origins and SHALL refuse requests from any other origin. A headless site SHALL also name where its front end handles each link the kit's emails carry (confirming an address, resetting a password, a receipt, a booking), and the deploy check SHALL refuse a headless site missing any of them, naming every one at once.

#### Scenario: a request from an unlisted origin

- **WHEN** a page on an origin not in `headless.origins` calls the content API from a browser
- **THEN** the request is refused, and the same call from a listed origin is answered

Verified by: `build/headless.test.mjs`, against the stack

#### Scenario: an email link with nowhere to go

- **WHEN** a headless site names no address for the password-reset link
- **THEN** `platformkit deploy` refuses, naming that link and any other missing one

Verified by: `build/headless.test.mjs` and `deploy-checks --test`

### Requirement: A module switched on that cannot work headless is refused

The build SHALL refuse a headless site with a module switched on whose manifest answers `false` for headless, naming each such module and its reason in one message. A module whose answer is an exception SHALL be allowed, and the build SHALL print the exception so the builder knows what to provide.

#### Scenario: the page builder on a headless site

- **WHEN** a headless site switches on a module that answers `false`
- **THEN** the build refuses, naming the module and why it needs reader pages

Verified by: `build/headless.test.mjs`
