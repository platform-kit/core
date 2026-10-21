# PlatformKit Features

This is the complete inventory of what PlatformKit Core and its default theme do for a site owner, its staff and its readers. It describes what each feature does, not how it is built. It is organized by the modules a site switches on and the surfaces people use.

A feature listed here is available to a site, not switched on everywhere. A site chooses its modules, its deployment shape (static files, a repository with a live backend, or cloud content), and its outside providers such as a payment processor, email relay or AI provider. A feature that depends on one of those works only where the site has chosen and configured it.

## Running a site

### Building, testing and deploying

- Develop, build, test and deploy a site from the site's own repository; the site never becomes part of PlatformKit.
- Run several sites side by side in development, each on its own local address (`<site>.localhost`), with a directory page of every local site and a live preview of each.
- Start a site with or without its database and backend functions; a new dev run cleans up after one that was closed abruptly, and one command stops everything a dev run started.
- Fetch separately owned sites into the workspace at a pinned version, and move to a newer version on purpose.
- Use exact published PlatformKit releases, or run PlatformKit straight from its public source.
- Add the site's own build steps beside PlatformKit's, list every step with whether it runs and why, and run one step on its own.
- Generate the site's pages, search data, sitemap, robots file, share images and favicon at build time; publish every public page pre-rendered for search engines and link previews.
- Check every public page at phone width for content that runs off the screen.
- Run the site's own tests and specifications alongside PlatformKit's checks, including a separate check of each deployment shape.
- Run every end-to-end check — database, functions and browser — on a test copy of each site built fresh from its files for the run, several sites side by side, without touching the copies used for development; a check that cannot run counts as a failure, and so does a function no check called.
- Refuse, in the quick checks, a function no test names, a test that stops early with a pass, a test that reaches a database without taking the run's, and a specification claim whose test does not exist or never runs.
- Refuse a deploy until it is confirmed and every setting the site's enabled features need is present, naming everything missing at once.
- Readers, staff and visitors reach only what is theirs or what their role allows: another person's orders, bookings, tickets, files, recordings, earnings and form answers stay hidden, and nobody can give themselves a staff role, a membership or an approval.
- Guest checkout, sign-up, form answers, analytics and the support widget each limit how much one visitor can send, without slowing anyone else; the limits are set in the site's policy.
- Keep server keys on the server: the site's published files are checked to carry none of its secret keys, only the public ones the browser needs.
- Deploy to Netlify, Render, an nginx container, Apache, Vercel or Cloudflare Pages with ready-made routing setups.
- In cloud mode, show search engines and link previews pages published since the last build.
- Close the whole site to everyone except administrators while it is being worked on (lockdown).
- Reset a local database to a known state that keeps the developer's own account, roles, membership and spaces.

### Modules and deployment shapes

- Switch features on or off by module. A module that is off disappears completely: its pages, admin screens, emails and build steps are gone, not hidden.
- Add the site's own modules, pages, admin screens, build steps and content types without changing PlatformKit.
- Choose one of three deployment shapes:
  - **Static:** a site of built files, with no live backend.
  - **Repository and backend:** content lives in the repository as files and is edited in the local admin and committed; the live site adds accounts, sales and the other live features.
  - **Cloud:** content lives in the backend, is edited and published in the live admin with no rebuild, and can optionally be pushed back to a repository.
- Run a documentation-only site in a plain documentation layout with no sign-in.

### The database

- Describe the database as the site's declared end state rather than a series of migrations; PlatformKit works out the changes needed to get there.
- Rename tables and columns without losing data.
- Refuse a change that would destroy data unless it is confirmed, while letting through drops that lose nothing.
- Bring spaces, teams, events, comment rules, achievements, bots and search into the database from the site's content, with no migration.
- In cloud mode, publishing updates the offers, booking types, tiers, forms, funnels and email designs the live site uses, with no rebuild.

### Payments

- Take payments through Stripe (the default) or Hyperswitch, or through a payment provider the site adds itself.
- Card details are entered in the payment provider's own secure form and never reach the site.
- What a buyer pays is worked out by the site's server from its own prices, discounts and shipping rates; nothing a buyer's browser sends can change it.
- Payment, booking, video and printer notifications are checked as genuine before anything is done with them; forged, altered, out-of-date or repeated ones change nothing.
- If the chosen provider can't do something an offer needs, the purchase is refused before anyone is charged.
- Stripe buyers pay on Stripe's hosted checkout; Hyperswitch buyers pay on the site's own checkout page, with an order summary, trial and renewal lines, and clear decline and verification messages.
- On Hyperswitch, PlatformKit renews memberships itself by charging the saved card.
- Hyperswitch can't sell goods that ship, collect tax, or pay providers. Using Stripe behind Hyperswitch also needs the Stripe account to allow card data from Hyperswitch, which the account owner arranges with Stripe.
- Products and prices set on the site are kept in step with the payment provider automatically.
- A Payments screen shows staff which provider is in use, what it can do, and a link to its own dashboard; secret keys are never shown.

## The admin

### The admin workspace

- One admin for the whole site, grouped into Dashboard, Content, Store, Sales, Marketing, Forms, Community, People, Social and Settings, showing only the enabled modules.
- Each staff role sees only its own areas and opens on a sensible home view:
  - **Administrator:** everything.
  - **Editor:** content.
  - **Analyst:** dashboards only, and can change nothing.
  - **Support:** the support desk only.
  - **Provider** (a coach or similar, renamed by the site): their own conversations, hours, bookings and page.
- A person can hold several roles; the last administrator can't be removed.
- In the repository-and-backend shape, the live admin is the live-data desks (dashboards, notifications, support, comments, orders, bookings, social, network, payments and people); content is edited in the local admin.
- The admin side menu can be folded to icons, and starts folded on a phone.
- On a local machine, administrators get a link to the local database console.

### Editing content

- List any content in a sortable, filterable table; create, edit, rename, publish, unpublish and delete records.
- Edit in a drawer or full screen, with mistakes shown on the field they belong to as you type.
- Edit text in a rich-text editor; any long text with chapter headings is edited chapter by chapter, with a contents list to open, reorder, add, remove and rename chapters.
- Edit structured values with proper controls (selects, checkboxes, lists, date and time pickers, a colour picker, a searchable icon picker, a number-and-unit control, audio and video track lists) instead of typing code.
- Preview a draft in the site's own design, beside the editor or full screen, for articles, wiki and docs pages, books, ads, products, collections, the storefront and landing pages.
- Edit every piece of the site's interface wording, with search across all of it and the theme's defaults shown until overridden.
- Keep one site-wide tag list, with or without letting writers add new tags; the same tag can't exist twice under different spellings.
- See, on an entry, when it is a variant in a running experiment.

### Publishing (cloud mode)

- Drafts stay separate from what is live; an unpublished record is still editable but is left out of the public site, search, sitemap and share images.
- A Publishing page lists every waiting change, including new records and removals, with who saved it and when; a removal can be called off.
- Publish one record, or everything at once with a note.
- Optionally push published changes back to the site's repository, with push status, the last error, a "Push now" button and automatic retries.
- Optionally rebuild the hosted site after a publish so search engines and link previews catch up.
- Download the whole content tree as a zip.

### Media library

- A file manager for uploads and site files: grid or list view, preview, upload, folders, rename, move, copy, delete, search, and copy a file's address.
- Every picture or file field opens the library as a picker.
- Search Unsplash from the picker when the site has a key; a chosen photo is copied into the library with the photographer's credit.
- Resize, crop, reframe, convert and round the corners of any library picture through its address.

### People

- See every account, searchable and narrowed to staff, providers, members, buyers or unconfirmed addresses.
- Open a person to see their roles, purchases, subscription, bookings, invoices and what the site has noticed about them (traits, visible to staff only).
- Grant and remove staff roles.

### Interface wording

- Every word the site shows lives in editable content, with the theme's wording as the default and the site's own wording on top.

## The site's look and pages

### Page builder

- Build landing pages from a catalogue of ready-made sections instead of writing layout code; drag to reorder, insert between sections, duplicate, move and remove.
- Pick sections from a searchable catalogue with a sketch of each, and edit each one through a simple form.
- Section types:
  - **Openers:** announcement strip (dismissible, optionally sticky, with a copy-code button), hero, marquee.
  - **Content:** features, split, bento grid, steps, how it works, showcase, before/after, carousel, tabs, gallery, video, prose, timeline, divider.
  - **Proof:** logos, statistics, testimonials, quote, comparison, FAQ, integrations.
  - **Commerce:** pricing, perks, products, product spotlight, collections.
  - **People:** team, the creator, coaching, newsletter, contact, form.
  - **The site's own data:** the library, articles, entries from a content model.
  - **Closers:** call to action, countdown, close, footer.
- Hero visuals: a picture, video, browser frame, phone or laptop mock-up, or a visual the site provides; an email sign-up and star ratings can sit in the hero.
- Pricing with a billing-period switch and a comparison table; statistics that count up as they appear.
- Every section shares one set of look options: tone, glow, background texture (grain, dots, grid, gradient, aurora), spacing, width, entrance animation and anchor.
- Per-page search title, description, share image, and an optional reading-progress bar.
- Mistakes are caught before a page is saved.
- Providers can build their own public page with the same builder.

### Look and identity

- Choose the site's look, colours and heading, body and code typefaces in Site settings; typefaces come from a searchable Google Fonts list, each shown in its own letters.
- Set colours separately for day and night, and put any colour back to the look's own value.
- Readers can switch between light and dark; the site follows their system setting until they choose.
- Preview another look on any page by adding `?look=<name>` to its address.
- Register the site's own looks, section styles, components and page sections, or replace the whole theme.
- Set the site's logo, favicon, share-card logo and X/Twitter handle.

### Header, footer and navigation

- Edit the header in Site settings: each link's destination (chosen from pages that exist), icon, and who sees it (guests, signed-in readers, paying readers, members, a tier, or staff); one link can be the call-to-action button.
- Links to switched-off modules disappear on their own.
- The header fits itself to the screen: search shrinks to an icon and links move into the menu as space runs out. It shows the bag count, the account menu, and community and network buttons.
- Set a site-wide footer.

### Search engines and sharing

- Generate page titles, descriptions, social previews, share images and favicons from each page's content and the site's settings.
- Generate share cards for the site, articles and other content, store items and landing pages.
- Publish a sitemap and robots file once the site's address is set; keep private pages out of search engines.

## Content

### Library and reading

- A content library with a lane for each content type, and a book filter by theme.
- A "For You" view of personal recommendations, shown only when there is something to recommend.
- "Find your book": a reader describes their problem in their own words and gets three matching books.
- Articles, wiki and docs pages can carry featured audio or video, a single track or a playlist, including YouTube and Vimeo.
- Access rules decide who sees what, by visitor class: guest, signed-in reader, buyer or member.
- Gated text is never sent to someone who may not read it: published pages carry only titles, descriptions, free chapters and a short opening, and a reader with access is sent the rest after the server checks their account. A static site doesn't publish gated text at all.

### Articles (`articles`)

- Publish articles with titles, descriptions, dates, images, tags, access rules and rich text, in an articles lane and listings.
- Read articles with shared typography, metadata, search, share cards, comments and featured media.
- Only published, accessible articles appear in listings and search.

### Books (`books`)

- A book shelf, book pages, covers, authors and descriptions.
- Read chapter by chapter with a contents list, next and previous, reading-time estimates, "Begin" and "Continue reading", and the reader's place saved.
- Bookmarks, highlights in colours with margin notes, search inside the book, and typeface and size settings.
- Read in full or in summary mode, with each chapter's bottom line and the book's introduction.
- Give each visitor class a set number of free chapters before the paywall.
- Chapter quizzes: answering all but one question right masters the chapter. Mastery earns bronze, silver and gold trophies, shown on the book cover and in the reader's accomplishments.
- Companion material per chapter where the site provides it: summaries, key points and quizzes.
- Buy a book to read online; pages say "Yours — read it now" or "Included in your membership".
- Owners download their PDF and EPUB editions from the book page.
- Listen to chapters where audio is available (see `tts`); buy printed editions where offered (see `print`).

### Wiki (`wiki`)

- Publish a wiki with folders, ordering, a wiki lane and listings.
- Each page has related pages, a contents rail, access rules and featured media.

### Documentation (`docs`)

- Publish documentation with folders, ordering, navigation and an on-page contents rail.
- Run a documentation-only site, with a collapsible navigation tree suited to phones.

### Content models and entries (`models`)

- Define the site's own record types in the admin, with fields of every common kind: text, long text, rich text, number, yes/no, date, date and time, link, email, choice, multiple choice, tags, a reference to another record, image, file, group and list.
- Give fields validation rules, uniqueness, and "show when" conditions; values are checked as they're typed and again on save.
- Rename a field across every entry; before changing a field's kind or rules, see how many entries would stop passing.
- Choose whether a model has public pages, which are listed in the sitemap and follow access rules.
- Show a model's entries in a landing-page section, or deliver them as data.
- Single-record models for one-off settings; models can also be declared in the site's code and still edited without a checkout.

### Search

- A search palette (Cmd-K) available everywhere, finding content by meaning as well as by words, with no outside search service.
- Filter by type, date (presets or a range) and tag, or type filters such as `type:` and `tag:`; results are grouped by kind and can be browsed with the keyboard.
- Search also finds store items, and people when the network is on.
- Search is built for every site, and kept up to date from live content in cloud mode.

## Readers and accounts

### Accounts and sign-in

- Sign in with email and password; optionally also with an emailed link or Google.
- One form signs in or creates an account, with a confirmation email, "send again", password reset, a dedicated sign-in page, and clear notices when a link has expired or been used.
- Sign-in prompts say why they're asking: to take a quiz, buy, get support, comment or book.
- Accounts appear only when a module that uses them is on.
- An account page: display name, private first and last name, a short bio, a username, and a switch to make the reader's page public.
- A face drawn in one of several styles (every part and colour adjustable, or "Surprise me") or an uploaded picture, used across the site.
- A reader's place, highlights, quiz results and assessment answers follow them across devices; a guest's progress joins their account when they sign in.

### Public profiles

- A public page at `/p/<username>` once the person makes it public: face, name, bio, follower counts, posts and achievements.
- Visitors can follow, mute, block or report the person, message them where they share a space that allows it, and book their sessions.
- A provider's page lists their bookable offerings, and they can design it with the page builder.

### Teams

- Groups of people defined by the site, filled automatically by rule, by invitation, or by hand.
- Members see their teams and why they belong; booking types can belong to a team.

### Achievements and traits

- Award achievements automatically from the site's rules.
- Each achievement has a public page (earned or not) with its badge, description and media, and can gate content behind it.
- Profiles show earned achievements and a quiet "still to earn" list; an achievement can be kept off public profiles.
- Traits are things the site notices about a person from their activity, visible to staff only.

### Comments, votes and reactions

- Comments on articles, book chapters, store items and events.
- Embed a comment thread on another website, where readers sign in inside it; the site chooses which sites may embed it.
- Show a page's comments as a forum post in a community room, so the conversation continues in both places.
- Hold comments from untrusted authors for review (trusted authors are staff, members, buyers and anyone already approved); a flagged-word list holds a comment and names the word.
- Choose who may comment, whether comments need approval, and whether reactions and votes are on.
- Votes, when on, add sort orders such as "best"; a low score never hides a comment.
- A Comments page where moderators publish, refuse, remove or reply, filtered by place, state and author; comments waiting for review also appear on the staff desk.

### Recommendations (`recommendations`)

- A personal "For You" shelf based on what the reader has read and bought; already-read pieces and finished books drop out.
- Without any reading history, the shelf invites the reader to start reading or take the site's assessment.
- Recommendation panels on a site's assessment results.

### The reader's app and assessments (`instrument`)

- A personal app area with tabs: the site's own, plus accomplishments, coaching or sessions, and chat, each shown only when its module is on.
- Run a site's own assessments, with screens such as choice, choice with "other", information, a timed one-word answer, a spoken sentence, and a book recommendation to close.
- Save answers to the reader's account, optionally only once their address is confirmed.
- PlatformKit runs the assessments; the questions, scoring and meaning belong to the site.

## Selling

### Store (`store`)

- A storefront with a hero, featured items, collection shelves, a membership band and an editions band; product and collection pages, and a collections index.
- Sell one-time products, downloads, books to read online, memberships, paid forms, paid sessions and the site's own kinds of offer.
- Products have photo galleries, "compare at" prices, display-only star ratings, a "New" badge, a best-seller badge worked out from the last 90 days of sales, tags and "You may also like".
- Sell variants with named options and their own prices, including options taken from a supplier's catalogue.
- Show "Sold out", "No longer made", "Only N left", or allow selling past zero; staff see stock counts; items in an unfinished checkout are reserved so they aren't oversold.
- Price lists for customer classes, such as a members' price.
- Promotions that apply automatically and stack: discounts on items or variants, buy X get Y, free or cheaper shipping, and whole-order discounts above a minimum spend, with dates, limits and budgets; on Stripe a buyer can also enter one promotion code.
- A shopping bag kept for 30 days, with quantities and a "Ships to" country.
- Shipping rates per country, extra shipping methods with surcharges and delivery estimates, and sales only to listed countries.
- Per-offer checkout terms: automatic tax, collecting a business tax number, accepted payment methods, and buyer-adjustable quantities.
- Clear outcomes after checkout: paid, cancelled ("no charge was made"), still processing, or couldn't be confirmed; a practice mode when payment keys are missing.
- Guest checkout for print and file purchases; a guest who later signs up with the same email finds their order and files once they confirm that address by its emailed link or a sign-in provider, so nobody can claim another person's order by typing their email.
- One order holds one choice of each product; a second size or colour of the same thing is checked out on its own.
- Receipt, "your files are ready" and "shipped" emails with tracking.
- A refund removes the access it bought.
- Fulfilment through Printify print-on-demand, through the shop's own packing room (staff mark orders sent), by download, or by book printers (see `print`).
- An Orders screen for staff with filters (by kind, to send, returns, refunded) and each order's payments, refunds, chargebacks, partial states, returns, exchanges and history; refunds and returns are recorded, not started, here.
- Optional comments on products.
- A Shopify-compatible storefront API, so headless stores and Shopify's own storefront client work with the site; opening an API cart link fills the site's bag and continues to checkout.

### Memberships (`memberships`)

- Membership tiers with weekly or monthly plans, more than one plan per tier, and ranks: higher tiers include everything the lower ones get.
- Free trials, at most once per person per tier.
- A membership can include a number of bookings of named session types per week or month.
- Members get access while their subscription is live; a failed renewal marks it as needing attention.
- Upgrades and same-tier changes take effect now; downgrades can be scheduled for renewal; choosing the current plan again cancels a scheduled downgrade.
- A Billing page showing the plan, its status (active, free trial, payment needs attention, ended), the renewal date, whether a saved card is ready for renewals, and plans to explore.
- Cancel at the end of the period and resume, in the app on Hyperswitch or in Stripe's billing portal on Stripe.
- A membership band in the store: "Become a member", "Switch to this", "You're a member".

### Usage-based billing

- Sell usage in units the site names ("credits" by default): prepaid packs, and metered plans with included units and an overage price.
- Charge for AI assistant work, spoken audio and speech recognition; the site chooses, per operation, whether the reader pays or the site absorbs it.
- The site sets its AI providers in order with fallbacks, their per-model costs, and its markup; unpriced work is refused, never given away by accident.
- A Usage tab on the Billing page, shown when the site sells a metered plan: balances (remaining, used, reserved), recent activity by kind, packs to buy, and the saved payment method.
- Automatic top-up: the reader chooses the pack, the threshold and their own monthly cap.
- Charge accrued usage in the middle of a period once it reaches a set amount, with recovery when the bank needs verification or a charge fails: verify, try again, or check status.
- While a usage payment needs the reader, a red banner on every page says so and links to Billing → Usage; dismissing it hides it until the next page, until the payment is settled.
- Work with no balance or plan is refused, and a bot says the reader is out of units with a link to buy more.
- A staff usage report: 30 days of usage, what it cost against what it was sold for, a below-cost warning, and retry for usage reports that didn't reach the provider.

### Providers and payouts

- People who sell their own time (coaches, therapists, teachers, renamed by the site) with their own offerings, page and earnings.
- Provider terms with versions; new terms are emailed in full and must be agreed before anything new goes on sale.
- Providers create bookable offerings (name, length, price, place) and move them from draft through review to on sale and retired.
- Payout rules: fixed weekly or monthly amounts, or a fixed amount or percentage per session held, with a holding period.
- Providers see what they've earned, what's held, payable and sent, line by line, with refunds reversing their share; they connect a payout account whose bank details the site never sees.
- A Payouts screen for staff: who is owed now, what's blocking each person, and sending to one person or everyone.
- Payouts work on Stripe, not Hyperswitch.

### Printed books and downloads (`print`)

- Offer each book in print and file formats with their own prices or markup, rights line and options.
- Buyers choose the contents (full text, a modern edition, or both, with or without the companion), cloth and foil colours, and can include the PDF and EPUB with a printed copy.
- Typeset books automatically with chapter openers, running heads, highlights gathered at the back, companions after chapters, dust jackets and foil.
- A 3D book that turns as it is dragged, and page previews, on the store page.
- Compare quotes from Lulu, Mixam and Bookvault, and choose a printer per format or let the site choose.
- Order one proof copy to the admin's address; only proofed editions can go on sale, and an unchanged book isn't typeset again.
- Print orders go to the printer automatically, with a staff screen (open, shipped, needs attention) to resend and check status.
- In cloud mode, set an edition from the admin with progress shown piece by piece.

### Sessions and scheduling (`sessions`)

- Booking types with a description, eligibility, price, membership requirement and booking limits.
- Book inside the site with available dates and times, confirmation and status, on the site's own scheduler or on cal.com.
- Where a session happens: a video room, a link, in person at an address, or by phone.
- Group sessions with seats, "N left" and an attendee list; several lengths to choose from; repeating courses (a course of six) where one session or the whole run can be cancelled.
- Bookable only within a date window; link-only booking types; host confirmation, with an automatic decline if unanswered by start time.
- Lock cancelling, rescheduling, time zone or notes; ask intake questions before booking, with the answers in the host's email.
- Team booking: round-robin, whoever is free, every host together, or each team member with their own copy.
- Hosts set named sets of hours, buffers, minimum notice, daily and weekly maximums, days off, and time away with a cover host.
- Hosts mark no-shows and move or cancel any session they host; staff can book for someone, free and outside their allowance, with several invitees.
- Readers reschedule or cancel eligible bookings; membership allowances and paid-session credits stay in step, and a cancelled paid session comes back as a credit.
- Guests can book public sessions, including a paid one, where the site allows it.
- A paid session includes a week of chat with the coach, and the host follows up in chat after the session.
- Calendar invitations in booking, moved and cancelled emails; reminders 24 hours and 1 hour before by default.
- Video rooms with no setup (browser to browser, up to five people, not recorded), or recorded rooms with a LiveKit account, or cal.com's video for cal.com bookings.
- A call page with a camera and microphone check, screen sharing, "end for everyone", opening 15 minutes early, and a recording notice.
- Recordings and transcripts attached to the booking, kept for a set time, with download.
- A booking page for each type that cal.com's embed can show on other websites, and a cal.com-compatible booking API with webhooks.

### Events (`events`)

- Dated and repeating events, each upcoming date shown, with a list and month view and "Your events".
- RSVP as going, interested or not going; capacity with "N spots left" and "Full".
- Paid registration, with the address or link revealed only after registering.
- Events for a chosen audience; cancel a single date with a note; comments on events; attendee names shortened.
- Events held in a community room, at a link, or at a real place; a reminder the day before.

## Forms and communication

### Forms (`forms`)

- Build forms in the admin with Build, Settings and Share views, one question group at a time or all on one page.
- Field types: text, email, URL, phone, password, number, dropdown, multiple choice, picture choice, rating, opinion scale, date, time, date and time, file, voice and video.
- Validation, conditional questions, branching by answer, progress, editable end pages, and earlier answers shown inside later questions.
- Require sign-in, allow one answer per person, let people resume an unfinished form, and close a form.
- Values in the form's link are saved with the response, for prefilling and campaign tracking.
- Publish a form on its own page, embed it on a landing page or another website (the site chooses which sites), or use the Typeform embed.
- Email sign-up fields in landing-page sections save to a chosen form.
- Paid forms: the price and checkout come first, each purchase buys one response, and an unfinished paid response can be finished later.
- Score quiz-style forms; raise a support ticket from a completed form, with its title and priority taken from answers.
- Responses: filter, open each answer with its time and files, export to CSV, and delete.
- Form analytics: started, finished, completion rate, daily trend, where people stop, and each question's spread of answers; written answers are counted, not listed.
- Signed webhooks on completion, retried if they fail.
- A Typeform-compatible API for responses, webhooks and insights, with form editing in cloud mode.

### Emails (`emails`)

- Design emails in a drag-and-drop editor with merge fields, sections repeated per order line, sections shown on a condition, and a subject per email.
- Emails the site sends:
  - **Store:** order confirmation, files ready, shipped with tracking.
  - **Accounts:** confirm your address or sign in, reset password, publisher invitation.
  - **Coaching:** a chat message while you were away.
  - **Sessions:** booked, time held, waiting on you, declined, moved, cancelled, reminder.
  - **Support:** reply notification, and a "waiting on us" digest to staff.
  - **Events:** event reminder.
  - **Providers:** new provider terms.
  - **Campaigns:** the frame for funnel and blast emails.
- Administrators can send a test filled with sample details.
- Each email is personalised with the order, booking, support or account details it is about.
- Email uses the site's own mail provider.

### Funnels and campaigns (`funnels`)

- Multi-step email funnels and one-off blasts, with a goal page to measure.
- Audiences built from rules: inactive, signed up, time since purchase or session, subscription, interest, level, answered, bought, not bought, role, community access and confirmed address, with a live count of who matches now.
- Steps timed by elapsed time, with daily, weekly and monthly sending caps, per-funnel cooldowns and opt-outs; "Run now" for a funnel.
- A blast shows its count and asks for confirmation; a sent blast is kept as a read-only record and can resume without sending twice.
- Editing or renaming a campaign never re-sends it to people who already had it.
- Chat prompts as steps: shown after time on site or on a page, on chosen pages, for signed-in or returning visitors, or with a full bag, as a pop-up or as the support panel's resting prompt, with choice trees up to three levels.
- Every marketing email has one-click unsubscribe with a confirmation page; order emails still arrive.
- Links are tagged so email visits show as campaigns on the dashboard.
- Analytics per funnel and blast: delivery, opens, clicks per link, unsubscribes, conversions and revenue for the goal, each step against the last, who is waiting or held back, the hours people open, time to open, phone share, results per version, and chat-prompt numbers.

### Reader support (`support`)

- A support launcher and panel on public pages for guests and signed-in readers, with an unread count and an optional prompt card above it.
- A standalone `/support` page, also used as a pop-out window.
- Readers can have several conversations, start new ones, mark their own question sorted, send text, files and voice notes (with transcripts), and see when staff are typing.
- An optional AI assistant in the panel, with "Talk to a person" at any time (see `bots`).
- Guests are invited to sign in so replies can reach them by email; a guest's conversations carry over when they sign in.
- A reader who was away gets one email per burst of replies, only at a confirmed address.
- Staff inbox: filters (open, pending, resolved; guest, reader, customer; mine or unassigned; unread), sorted by longest waiting or latest activity.
- The contact card shows identity from the account only, marks guests and unconfirmed addresses, and holds private staff notes.
- Staff assign, mark pending, resolve and reopen; send canned replies; export a conversation as text; delete a conversation and its files for good.
- Tone and notification alerts when a message arrives while the inbox tab is hidden.
- Overdue conversations are escalated to staff by email when nobody has been at the desk; conversations reopen when the reader writes again.
- Limits on spam from anonymous visitors, old attachments deleted after a set time, and guests never asked to type a name or email.
- A Chatwoot-compatible API with webhooks, and Chatwoot's website snippet putting the site's support widget on other websites.

### Support tickets

- Tickets for tracked work: a number people can quote, a title, description, priority (low to urgent), category, open or resolved, several assignees, and due dates.
- A ticket with or without a contact, so staff can raise internal work.
- One timeline per ticket: replies, internal notes, files, and every change; one box writes a reply or an internal note.
- Link tickets to support conversations; a conversation shows its tickets.
- A staff ticket list with search, state tabs, assignee filter, sort orders, and filters by the form answers a ticket was raised with.
- Tickets show what's owed and how long they've been open, and reopen when the contact writes again.
- Readers see their own tickets in the support panel and the community, read the public timeline (never internal notes), reply, and raise new ones.

### The staff desk

- One list of everyone waiting on staff: support chats, coaching conversations, comments awaiting review, social comments and messages, and sources the site adds.
- Longest wait first; each row shows its source, who is waiting, the last message and what's owed ("due in", "overdue", "waiting").
- What's owed follows the site's support wait time and each coaching plan's promised reply time.
- Reply with text, files or voice notes, which go back where they came from; assign, mark done or bring back; live updates; a waiting and overdue count per queue.
- If a source fails to load, its last rows stay on screen, marked possibly out of date.
- One policy sets email caps, the support escalation wait, how recently staff must have been at the desk, attachment and recording retention, and session reminder times.

### Coaching chat (`coaching`)

- A members' conversation with their coach, one thread per member and coach, with a staff inbox.
- Text, files, images, voice notes with transcripts, reactions, replies and withdrawing a message; unread counts and sent and read marks.
- Coaches can find any member to start a conversation.
- Chat is open by plan, or for a week around a paid session; coaches see the reply time each member's plan promises.
- An away email when appropriate, never while the other person is on the site.
- The site chooses where chat lives: in the reader's app or in the community.

### Staff browser notifications (`push`)

- Staff opt each browser into topics: new support conversations, new support messages, purchases, accounts, memberships and bookings.
- Support topics go to the support desk; the rest go to administrators.
- Send a test notification, and see and remove other browsers that get notifications.

## Community and social

### Spaces (`spaces`)

- Staff, community and server spaces, each with its own place in the sidebar.
- Membership follows rules automatically: all staff, live members or a tier, buyers of a product, anyone with a booking, a custom rule, or invitation only; rooms can be narrower, such as "bought in the last N days".
- A "Discover spaces" page showing what it takes to join; open, on request, or approval spaces, with guidelines and entry questions; moderators approve requests.
- Invite links with use limits, expiry and revoking.
- Roles per space (name, colour, rank) and permissions: voice notes, attachments, moderate, invite, announcements and @here, granted to everyone, a role, a tier, buyers or one person, optionally for N days.
- Room types: chat; forum (titled posts, sorting, unanswered and your posts, a full-page post view); and feed (posts with photos and video). Rooms can be open, private or archived, and grouped under headings.
- Messages can be edited, deleted, pinned, saved for later, drafted, scheduled to send later, and formatted, with emoji, typing indicators, unread and mention badges, "mark all read", "jump to latest" and catching up after being away.
- Threads, optionally also posted to the channel; mentions of people, roles, everyone and @here.
- Direct messages across spaces, including group messages; people and spaces can turn direct messages off.
- Notification control per channel (mentions, all, nothing), muting a channel for a time, muting a space, and muting a person.
- Presence: active, away and do not disturb, with an online indicator.
- Search by who, where and when.
- Personal views: threads, unread, mentions, saved, drafts and starred channels.
- A space home with a greeting, recent activity, upcoming events and members; a community front page across all your spaces; a welcome room for newcomers to read first.
- Member cards: what the space calls the person, join date, message count, bio, and private panels from the site (such as what they've read or bought) visible only to them and staff.
- Badges that moderators give, shown beside names.
- Polls with single or multiple answers, closing, and who answered.
- Voice notes and file attachments with size limits.
- Huddles: small browser-to-browser calls with microphone and camera, docked in the sidebar.
- A moderation queue: reports with reasons; delete a message, mute someone for a time, remove someone, or dismiss; every action logged.
- Operations rooms where the site posts its own events: purchases, new memberships, failed print orders, new accounts and escalated support.
- The staff desk and support tickets live in the community (see "The staff desk" and "Support tickets").
- Bots in rooms: "Ask {bot}", slash commands, and drafts held for review (see `bots`).
- Two community layouts: workspace chat (the default) or a social layout like Circle or Skool; the site can rename the community's address and hide places.
- Lock community places such as events, messages and notifications behind a membership or purchase, with a join card.
- Keyboard shortcuts with a help sheet.
- Admin: rooms, people, roles and permissions, and moderation of recent messages.
- Matrix compatibility: Element, FluffyChat and other Matrix apps sign in with the site password and use the rooms a person can already read.

### Encrypted channels (`space-encryption`)

- Make a space or channel end-to-end encrypted, readable only on members' own devices.
- Each browser is set up separately, with a one-time recovery key to read earlier messages on a new device.
- Messages sent before someone joined stay unreadable to them; notifications and reports from an encrypted room carry no words.
- Encrypted rooms have no search, no bots, and no moderation of message contents; Matrix apps can take part in them.

### Member social network (`network`)

- A page per member, follows, a following timeline (including pinned spaces' feeds) and a Discover timeline.
- Posts with replies, likes and reposts, up to 10 photos or videos with alt text, and an audience: everyone, the site's members, or a space's members. Replies can't reach more people than the post they answer.
- Explore: people search, "Who to follow", and an optional "For You" grid of photos and video.
- One notifications page for likes, reposts, follows, replies and quotes, and for space mentions, thread replies and upcoming events, grouped and filterable.
- Block, mute and report; admins remove posts and suspend people for a day, week, month or until lifted.
- Make reading or posting a paid feature.
- Each member can choose to join the wider Bluesky network, getting a handle and sharing their public posts; leaving warns that copies may remain.
- Members can use Bluesky's app and other AT Protocol apps with app passwords they create and revoke, when the site allows it.

### Social publishing (`social-publishing`)

- Connect X, Reddit, Threads, Bluesky, YouTube, TikTok, Instagram and LinkedIn accounts, directly or through Zernio, Post for Me or PostFast.
- Invite publishers with permissions per account; an account can require approval, with a "Needs approval" queue.
- Draft posts with media, schedule them on a month or week calendar in a chosen time zone, and see delivery per account; Reddit posts take a subreddit and title.
- Retry a failed post, mark one as published, or remove a published post from the platform.
- Analytics: impressions, reach, engagement, clicks, views, likes, comments and shares, and account performance.
- An inbox for messages and notifications; search posts, look up profiles, and follow, block or mute from the connected account.
- Reply to comments and messages according to each publisher's permissions.
- Keyword automations that reply publicly or by message, either reviewed first or sent automatically, with a history to review, edit or discard.

## Marketing and measurement

### Analytics

- A dashboard with tabs: overview, acquisition, audience, content, commerce, usage, events, experiments and explore; ranges of 7, 30, 90 or 365 days, and an "on the site now" count.
- Headline numbers (visitors, views, sessions, views per visit, bounce rate, session length and goals) compared with the previous period.
- Acquisition: direct, search, social, email, AI and referral channels, with referrers, campaigns, entry pages and exit pages.
- Audience: new and returning visitors, devices, browsers, systems, time zones, languages, countries, an hour-by-weekday grid, and an 8-week retention grid.
- Commerce: free and paid members, joins and lapses, monthly recurring revenue, and the content and channels that brought members in.
- Events and goals, including the site's own, with counts, people, trends and top values.
- Content analytics: engaged minutes, how far pieces are read, what readers read next, what each piece led to (last-touch conversions), rising, fading and evergreen pieces, "reading now", breakdowns by author and topic, and CSV export.
- Click a row to filter the whole dashboard; filtered views survive a reload and can be shared as a link.
- Show any chart as bars or a line.
- Reports for forms, funnels, support, experiments and usage where those features are on.
- Other websites can report into the dashboard with a drop-in script or PostHog's own SDKs.
- No IP addresses are stored, opt-outs are honoured, and dashboards show totals rather than lists of people; analytics are visible to administrators and analysts only.
- The site can add its own dashboard panels.

### Ads and experiments

- Site-written ads as a popup or corner card, a card at the end of articles, both, or a closing section under a page.
- Target ads by audience, by topics (any or all), by how much someone has read on those topics, and by the current page; a cooldown after an ad is seen or dismissed, and a full popup at most once an hour.
- Experiments on pages and ads with weighted variants that follow a signed-in reader across devices.
- Pause, resume, end, extend, declare a winner and add variants; see exposures, conversions, rate and lift.
- An experiment ends two weeks after its first exposure by default, then shows the winning variant automatically.

## Automation and AI

### Bots, tools and commands (`bots`)

- Bots appear only once the site has a live AI provider and has opted in to spending; until then no bot features are shown anywhere.
- Create bots, skills, tools and slash commands in the admin as ordinary content, in any deployment shape.
- Bots work in community rooms, on the support desk, in coaching conversations, in social automations, and by voice.
- Call a bot into a room by @-mentioning it, from any app including Matrix apps.
- Slash commands: typing `/` lists the commands a person may run, with each command's options as form controls rather than typed syntax.
- Wake bots on a schedule (daily, weekly or monthly at a set time, into a chosen room) or on site events such as a payment, new membership, failed print order, new account or escalated support conversation.
- On the support desk, a bot can draft replies for staff to approve, answer when the reader asks, or answer everything; in coaching it drafts by default.
- A reader can ask for a person at any time, and the bot stays out of that conversation until staff pick it up.
- A bot's short list of options appears as buttons the reader can press.
- A ready-made front-desk bot, off by default.
- Built-in abilities: search the site's content; look up the person's orders, parcels, membership and tickets; look up what's for sale; list events; raise a ticket.
- Add the site's own tools from an API description, with secrets kept on the server, or as code.
- Skills: written instructions a bot opens when it needs them, which can bring extra tools.
- Choose who each bot and tool is for: anyone, signed in, buyers, members, a tier, staff, or buyers of a product.
- Bots remember within a conversation, across a person's past conversations, or long term, as the site chooses.
- Limits per answer (steps, spending, time and tool calls) and spending caps per person by minute, hour, day, week and month; a bot stops before going over and says so in words the site can edit.
- In a room, people see a bot thinking, can stop it, and see why an answer failed.
- Bots are never offered in encrypted rooms.
- Several AI providers in order, with fallbacks.

### Voice assistant (`copilot`)

- A full-screen voice page where a signed-in reader talks to a bot out loud.
- Interrupt the assistant, mute, hold to talk, or type instead, with a live caption and a transcript to show or hide.
- Past conversations saved to reopen, start fresh or delete.
- "What I remember": readers see what the assistant remembers about them and remove items.
- Reader settings: voice, one of 31 languages, speed, visual style, and always listening or hold to talk.
- The site chooses each bot's voice service (an on-device voice or its own), the voices offered, a greeting and visual style.
- Time and spending limits per conversation, with a spoken closing line; speech time counts toward the reader's usage.
- Other voice front ends, such as a phone line, can reach the same bots.

### Spoken books (`tts`)

- Play recorded chapter audio where it exists, with a waveform to drag through and 1×, 1.25× and 1.5× speeds.
- Summaries and introductions are read aloud too.
- Generate missing chapters in the reader's browser, in order from the current chapter, showing download and progress; a chapter made by one signed-in reader is shared with the next.
- Recordings can be prepared ahead of time; the site can turn in-browser generation off.
- Books stay readable without audio.

### Voice notes and dictation

- Voice notes in support, coaching and community rooms get a written transcript where the browser supports it.

### Editorial enrichment (`enrichment`)

- Generate book introductions and companions (summaries with highlighted lines, key points, and quizzes with explanations) from the admin's book list.
- Watch each stage appear with its cost, and stop a run; one run per book at a time, with a spending cap.
- Generated material is checked against the book and kept for review; in cloud mode it is a draft an admin must publish, and a run never replaces a published companion.
- Re-running redoes only what changed, so nothing is paid for twice.
- Runs only when staff start one, with a configured AI provider and the site's spending opt-in.

## APIs and connections

APIs come with the module they belong to, and the compatibility APIs also need the `api` module.

- **Content API (`api`):** Contentful-compatible delivery, preview of drafts, GraphQL, sync, an images API (resize, crop, format, quality, rounded corners) and publish webhooks; writing through the management API in cloud mode.
- **API keys:** create keys in Settings → API (delivery, preview, management, and forms, scheduling, storefront and support keys when those modules are on), choose whether each may read gated content, see when each was last used, and revoke them; rate limits per key; the site chooses whether content can be read without a key.
- **API reference:** an interactive reference at `/api` for everything the site actually serves, in the site's light or dark theme.
- **Forms API:** Typeform-compatible responses, webhooks, insights and embeds.
- **Store API:** Shopify-compatible storefront for products, collections and carts.
- **Scheduling API:** cal.com-compatible bookings, availability, schedules and webhooks, with cal.com's embed.
- **Support API:** Chatwoot-compatible client and staff APIs with webhooks, and Chatwoot's website snippet.
- **Matrix:** Matrix apps sign in and use the rooms a person can read, including encrypted rooms.
- **AT Protocol:** Bluesky and other AT Protocol apps use the site's network, with each space as a feed.
- **Analytics:** a drop-in script and PostHog's SDKs report from other websites.
- **Webhooks:** the site's config can send content publish and form completion events to other services.

## Not built

- **Translation (`translation`):** reserved, not built. Interface wording is editable, but sites aren't translated into other languages.

For the project's objectives and intended audience, see [PURPOSE.md](./PURPOSE.md). For the capability comparisons, see [COMPETITORS.md](./COMPETITORS.md). For setup and constraints, see the [PlatformKit documentation](../sites/docs/content/docs/what-platformkit-is.md) and the [module reference](../sites/docs/content/docs/building-a-site/modules.md).

---

**Sources:** `openspec/specs`, `packages/kit/build/modules/kit.mjs`, `packages/kit/build/modes.mjs`, `packages/kit/build`, `packages/kit/supabase`, `packages/kit/src/lib`, `packages/kit/src/payment-provider.mjs`, `packages/kit/src/payment-provider.d.ts`, `packages/movable-types/src`, `sites/demo/platformkit.config.js`
**Reviewed:** `2026-10-17`
