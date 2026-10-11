# Features

<!-- sources: openspec/specs, packages/kit/build/modules/kit.mjs, packages/kit/build/modes.mjs, sites/demo/platformkit.config.js, packages/movable-types/src -->

PlatformKit combines a reusable site foundation with optional features. The list below describes what the project has built, not what every site automatically turns on. Site owners select modules, supply their own content and rules, and connect outside services where a feature needs them.

## Create and manage a publishing site

- Build reader-facing sites with a ready-to-use theme, shared design system, reusable page layouts, and a visual page builder. Site teams can choose from a broad catalogue of page sections and adapt the appearance to their own identity.
- Publish articles, books, reference material, documentation, landing pages, and site-specific structured content.
- Edit content and site settings in an administrative workspace. Editors work with forms suited to the content rather than raw configuration text, preview drafts, and publish changes. A site without a live backend can still be maintained through its repository.
- Keep published material in files, or use a backend-backed content workflow when a site needs to publish without rebuilding the whole site.
- Create share previews and search-engine information for pages and published content; generate share images from the site's own visual style.

## Give readers ways to find and use content

- Offer books with a dedicated reader, chapter navigation, access rules, saved reading state, and optional audio.
- Provide a searchable library of site content. Search combines word matching and meaning-based discovery and can work on a static site.
- Offer personalized reading recommendations based on a reader's activity when the site has the relevant account and content data.
- Add reader accounts, profiles, roles, comments, voting, awards, and other account-based participation where enabled.
- Build a site's own questionnaires or other interactive readings. The toolkit provides the general forms and runner; the site defines the questions, interpretation, and language. It does not ship one organization's proprietary assessment as a universal PlatformKit feature.

## Sell products, memberships, and printed books

- Create a storefront with product pages, collections, a shopping bag, checkout, shipping choices, orders, and downloadable files.
- Offer one-time purchases and recurring memberships, organize memberships into levels, and manage account access and billing changes.
- Sell books in several forms, including digital editions and printed copies. The book workflow can prepare editions, covers, prices, and print orders through supported print providers.
- Offer paid or membership-based bookings, with eligibility rules and usage limits. A site can use the built-in scheduling approach or connect a calendar service; video calls can be connected where configured.
- Let a reader buy eligible printed items or files without first creating an account; account-based services still require sign-in.

## Support readers and bring people together

- Add a support chat for visitors and readers, with a staff inbox, assignments, private notes, attachments, canned replies, and follow-up prompts.
- Provide a separate coaching conversation area for members and staff, including live updates and optional voice messages.
- Create community spaces with rooms, channels, discussions, direct conversations, events, and group calls.
- Run a site's own member social network with profiles, follows, posts, and feeds. Sites can optionally connect it to compatible social-network apps.
- Schedule social posts from the site's administrative tools when connected accounts are configured.
- Enable end-to-end encryption for eligible community channels as an explicit option; encrypted channels trade away some server-side search and moderation capabilities.

## Collect responses and communicate with an audience

- Build forms, collect responses, and connect form submissions to a site's own workflows.
- Create automated email sequences and one-time campaigns, with audiences based on information a reader has chosen to share through their account or activity.
- Design transactional and campaign emails in the administrative workspace; track campaign delivery interactions and honor unsubscribe preferences.
- Send optional browser notifications to staff for selected events.
- Use site events and dashboards to understand publishing, store, membership, campaign, and reader activity. Reports summarize activity; they are not intended as a dump of individual readers' private answers.
- Add experiments to compare eligible page or advertising variations and measure their outcomes.

## Automate and enrich site experiences

- Configure task-oriented bots with tools, schedules, and boundaries set by the site.
- Add an optional conversational assistant, including spoken interaction, when a site has configured the required backend and provider access.
- Prepare spoken versions of books. Recordings can be provided ahead of time or generated by a compatible reader's browser, depending on the site's setup and the reader's device.
- Run optional, assisted editorial workflows for book introductions and companion material. These use a configured model provider and may incur usage charges; they are not silently run as part of ordinary reading.

## Connect to existing services and choose how to run the site

- Connect common payment, email, calendar, print, and social providers where the corresponding feature is enabled and credentials are supplied.
- Expose compatible interfaces for selected commerce, content, forms, scheduling, chat, and social-network workflows, so existing tools and clients can integrate with a site's own domain.
- Choose a static site with no live backend, a repository-and-backend setup, or a backend publishing workflow where content changes do not require a full site rebuild. The feature set differs by setup: accounts, orders, and conversations need a backend; a static site can still publish and search files.
- Develop and test multiple independent sites against the shared toolkit without making those sites part of PlatformKit's product identity.
- Route selected workspace sites, including separately fetched repositories, through one local front door, with each hostname directed to its own development server.

## Availability and limits

Most capabilities are optional and are enabled per site. Some need a backend; others also need an outside provider account, credentials, or a site-specific registration. A feature's presence in this list does not mean a particular installation has configured it or that every provider is connected. The generic demo exercises many capabilities as a test site, not as a guarantee that every possible configuration has been tested in production.

Translation is reserved for future work and is not currently a built feature. Site-specific content, assessments, branding, editorial policies, and business rules belong to the site using PlatformKit, not to the shared toolkit.

For the purpose and intended audience, see [PURPOSE.md](./PURPOSE.md). For implementation-level documentation and current constraints, start with the [PlatformKit documentation](../sites/docs/content/docs/what-platformkit-is.md).
