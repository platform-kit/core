# Purpose

PlatformKit exists to let a team run the parts of its business that belong on its own site—publishing, paid access, sales, services, communication, and community—together as one product and ship them with one deploy. Its objective is to make different business models configurable as combinations of shared capabilities, rather than separate products that happen to share a brand.

## The objectives

### Run different business models on one site

A publishing business may sell books, offer memberships, book coaching, and host a community. An educator may publish lessons, charge for access, and run events. A service business may need accounts, subscriptions, bookings, and a support desk without being a publication at all.

PlatformKit provides these as capabilities that can be combined. The site can present them through one reader experience, apply its own rules to who can use them, and operate them from one administration and deployment. A team does not have to assemble an unrelated hosted product for every part of its work or send its audience through a different service for each interaction. The goal is one deployable site for the chosen combination—not a claim that every module is active in every deployment or that outside providers are unnecessary.

### Keep the site's work separate from the framework

The site's custom content, identity, and business rules belong to the site—not to the reusable framework. A site team can maintain its own material and configuration in its own project while PlatformKit provides shared capabilities and improvements independently.

That separation is meant to work in both directions: the framework should not acquire one site's identity or editorial material, and a site should not need to fork the framework just to express its own voice, content, or policies. The framework and a site's content can therefore be maintained, reviewed, and released on their own tracks. Sites can register their own additions where the shared capabilities do not fit.

### Make capabilities optional without making them fragments

A site chooses the capabilities it needs. Publishing, a store, memberships, sessions, support, community, and other modules are not a mandatory bundle; turning a capability off should remove its related experience rather than leave a dormant feature in the product.

When capabilities are combined, they should behave as parts of one site. Accounts, content, administration, and deployment provide shared context, while each feature keeps its own purpose and rules. For example, a paid membership can govern access to both content and a community, instead of those areas maintaining unrelated accounts and entitlements. A site chooses its payment and inference providers once, and can price individual services separately, so different features need not share one price.

## Product and design decisions

### Publishing is a first-class use, not a prerequisite

The reader and published material are central to PlatformKit's shape: a site may have a library, articles, books, a wiki, or documentation, and connect those to paid access and other services. But a site does not have to publish content to use the platform. A service or software business can select the capabilities it needs without adopting a publishing identity.

### One site owns the reader relationship

The site is where its audience reads, buys, joins, books, and communicates. PlatformKit is designed to keep those activities within that site and under the site's policies, rather than making an external platform the only place a customer can interact with the business.

This does not mean every outside service is replaced. Payment processors, calendars, printers, email relays, and other providers can remain part of the system. The site owns the product experience and the rules around those services.

### Prefer clear conventions to a large settings surface

PlatformKit makes deliberate choices about how common work is represented and edited. Published content is authored in maintainable records; the admin presents structured fields instead of asking people to type configuration syntax; reader-facing language can be maintained as content; and a capability's policies should have an identifiable owner. Source files are the declarations for the database and the external services the site uses, rather than mirrors of independently edited catalogs.

These conventions aim to make the built-in features work together and stay understandable. They are not a claim that every site must use the same content, appearance, or business model.

### Keep the visual system replaceable

The shared theme supplies a coherent default reader and admin experience. A site can choose its own look, replace components, and provide its own language without changing the reusable kit. A default is a starting point, not the site's identity.

### Support more than one way to operate

Some sites need only a static build. Others need a repository-backed site with a live backend, or cloud publishing that can update content without rebuilding the site. PlatformKit treats these as different operating choices, so a site can select the one that fits how its content and backend are managed.

### Keep a clear line between shared and site-owned work

The kit and theme provide reusable mechanisms; the site supplies its own material, brand, policies, and registrations. A generic demo demonstrates combinations of those mechanisms, but is not the definition of the platform and does not make its own content or business rules part of Core.

## Who it is for

PlatformKit is for independent publishers, educators, membership organizations, coaches, and other teams that want to operate a digital product on a site they control. It is also for teams whose business is services or software and who want common capabilities such as accounts, billing, bookings, support, or community in one deploy.

It is most useful when several of those needs belong together, the team wants to own the site experience, and its content and policies should remain portable with the site rather than being trapped in a collection of unrelated tools.

## What PlatformKit is not

PlatformKit is not a hosted website service, a finished site for one organization, or a requirement to enable every module. It does not supply a site's editorial work, brand, business decisions, hosting, payment account, calendar, printer, or email provider. A capability that relies on an outside provider still needs that provider to be configured.

For the built capabilities and their sub-features, see [FEATURES.md](./FEATURES.md). For the capability-by-capability comparison, see [COMPETITORS.md](./COMPETITORS.md).

---

**Sources:** `openspec/specs/kit-principles/spec.md`, `packages/kit/build/modules/kit.mjs`, `packages/kit/build/site.mjs`

**Reviewed:** 2026-10-22
