# analytics

## Purpose

What readers do, read back for the people running the site: events written once per thing that happened, dashboards that summarise and never list a person, and the sales that decide the best seller.

## Requirements

### Requirement: Events are the record

Every reader action worth knowing SHALL be an `events` row with a stable anonymous id — a **fingerprint**, FingerprintJS's open-source `visitorId`, computed in the browser once per page load and cached, the same for a guest across storage cleared, a private window and a return weeks later, on this site and in the drop-in script alike; a random id only where no fingerprint can be computed — and the user when signed in — written through **one door**, `<domain>/v1/ingest`, by the site's own `capture()`, by the drop-in script, and by any official PostHog SDK pointed at the site — the door SHALL take PostHog's own wire protocol beside its own: PostHog's event shape at `/e/`, `/i/v0/e/`, `/capture/` and `/batch/` in its encodings (gzip-js, base64, plain JSON, and a gzipped body from a server SDK), the registered key as the event's `token` or the batch's `api_key`, `` as the anonymous id, `` as the session and `distinct_id` as the person, and SHALL answer PostHog's flags, remote-config and recording endpoints so the SDK runs as it would against PostHog with every such feature off; the door SHALL refuse a type that is not a well-formed name (letters, digits, `_`, `$`, `:`, `.`, spaces; 64 characters), a batch over its size, a source key it does not know or an origin the source does not allow, SHALL take the signed-in user from the caller's session and never from the body — on a PlatformKit site a signed-in account is identified by that alone, with no call to make, the moment the session exists; an external site identifies its own people through `posthog.identify` and gets a `distinct_id` — and SHALL stamp on a session's first event the country the host's geo header reports (none locally — *unknown*, never a guess). The kit's own types are the checked list (`pageview`, `click`, `content_view`, `content_read`, `cta_impression`, `cta_click`, `session_start`, `session_end`, `experiment`, `book_quiz`, `find_*`, `support_*`, `form_*`); **a site defines its own** in its config (`analytics.events`: a key, a label, whether it is a goal, the property that is its value) and any other well-formed name a script sends is kept as sent. An **external source** is registered in the config (`analytics.sources`: a key, a name, the hosts allowed to send under it); its events carry the source and the `distinct_id` the script identified, never a user of this site. PostHog is loaded only when `VITE_POSTHOG_KEY` is set; the prerender and the preview write nothing. A session's first event SHALL record what is known on arrival and nowhere else: the entry path and referrer, the UTM tags on the landing address (source, medium, campaign, term, content), the device class (phone, tablet, desktop), the browser and system family, the time zone and the language — and never an IP address; the country is the door's to stamp, and the fingerprint is the id, never a stored list of what it was made of. A browser that has opted out SHALL send no fingerprint: its events still come, under a random id kept in its storage (new when that is cleared), and nothing else changes.

#### Scenario: an unknown type

- **WHEN** a script sends an event named `<script>alert(1)` or one 200 characters long
- **THEN** the door refuses the batch (400) and nothing is written; `Signed up for the webinar` is kept as sent

Verified by: `analytics.test.mjs` against the served `ingest`

#### Scenario: a source's events

- **WHEN** the demo's config registers a source `landing` allowed from `landing.example`, and a page there loads `/analytics.js`, calls `posthog.init(<the key>, { api_host })`, `posthog.identify('u-42')` and `posthog.capture('signup', { plan: 'monthly' })`
- **THEN** a `$pageview` and a `signup` land with `source = landing`, `distinct_id = u-42`, no `user_id`, the page's `$current_url`, `$referrer`, `$host` and `$pathname`; the same batch under a key the config does not know, or from an origin the source does not allow, is refused (403) and nothing lands

Verified by: `analytics-sdk.test.mjs` — the built script in a headless page against the served function, the rows read back

#### Scenario: the same guest, twice

- **WHEN** a guest opens the site, clears the browser's storage (or opens a private window) and opens it again
- **THEN** both visits carry the same anonymous id, and Audience counts one returning visitor, not two new ones

Verified by: `analytics-sdk.test.mjs` — two headless contexts of one browser giving the same `anon_id`; the arrival parser's test unchanged

#### Scenario: PostHog's surface

- **WHEN** a page written for PostHog changes only the script's URL — to `<domain>/analytics.js`, or keeps PostHog's own snippet with `api_host` set to this site, which loads `<domain>/static/array.js` — and calls any public method of `posthog-js`'s `PostHog` (every one its type declarations list, `people.set` among them) with PostHog's arguments
- **THEN** every one exists as a function with PostHog's return shape and none throws: the super properties ride on every later event, an opted-out page keeps sending under a random id and no fingerprint (where PostHog's would fall silent — the docs say so), a reset drops the identified person and the super properties, and the flags, surveys and recording answer `false`, `undefined` or nothing

Verified by: `analytics-sdk.test.mjs` — the public methods read from the installed `posthog-js` type declarations and each checked on the built object, then the behaviours in a headless page

#### Scenario: a tagged arrival

- **WHEN** a browser lands on `/store?utm_source=newsletter&utm_medium=email&utm_campaign=autumn` from a Safari on an iPhone in Amsterdam
- **THEN** its `session_start` carries `utm.source = newsletter`, `medium = email`, `campaign = autumn`, `device = phone`, `browser = safari`, `os = ios`, `tz = Europe/Amsterdam`, `lang = en-GB` (as the browser says it), and no later event of the session repeats them

Verified by: `analytics.test.mjs`, a kit test of the arrival parser with fixed user agents and addresses

#### Scenario: the official SDK, one host changed

- **WHEN** the real `posthog-js` build is loaded in a page with `posthog.init(<a registered key>, { api_host: <the site> })` and calls `identify('u-7')` and `capture('signup', { plan: 'monthly' })`, and a server posts PostHog's `/batch/` shape with the same key and a gzipped body
- **THEN** the `$pageview`, the `signup` and the batch's events land as the source's rows with `distinct_id = u-7`, the session and the anonymous id from PostHog's ids, every property kept; the SDK's flags request is answered with no flags and its remote-config request with an empty config, and nothing errors in the page; the same under an unregistered token is refused and nothing lands

Verified by: `analytics-sdk.test.mjs` — the installed `posthog-js` dist in a headless page against the served door, and a `/batch/` post in each encoding

### Requirement: The dashboards summarise, never list

`admin_series`, `admin_content`, `admin_find`, `admin_support`, `admin_forms`, `admin_funnels`, `admin_funnel`, `admin_now`, `admin_piece`, `admin_members` and the experiment reads SHALL return counts, shares and top-N words — never a table of every answer or every person; `email_audience_count` is a number. The dashboard SHALL report only what the site has on — the store's numbers with the store module, the instrument's with the instrument, membership's with memberships, the funnels' with the funnels module — every tile against the window before, a section with nothing in the window saying so in one line rather than a grid of zeros, and a page's engagement as the average of its measured reads (`content_read` seconds), never a guess from the gap to the next page.

The dashboard SHALL lead with **visitors** (distinct browsers), views, sessions, views per visit, bounce rate and session length, and with the site's **goals** — sign-ups, and with their modules purchases and memberships — each as a count and a rate per hundred visitors, against the window before; its head SHALL say how many are on the site now (a browser with an event in the last five minutes). It SHALL be tabs, one shown at a time and remembered per browser: **Overview** (the headline, the traffic a day); **Acquisition** (the **channels** — Direct, Search, Social, Email, AI, Referral, told from the referrer and the UTM tags by one rule — each with visitors, sessions, bounce, sign-ups and their rate; the referrers under them; the campaigns by UTM source, medium and campaign; the entry pages with bounce and sign-ups; the exit pages); **Audience** (new against returning visitors, devices, browsers, systems, time zones, languages, the hours they come as hour by day of the week, and how many were guests, signed in, members); **Content** (the most viewed pages, the most engaging, topic demand, and the diagnostic with the instrument on); **Commerce** (the store; the membership as a business — members free and paid, joined and lapsed in the window, monthly recurring revenue, a series of members a day, the content and the channels that brought them; the ads); **Experiments**; **Explore**. Beside the range, an **audience filter** — Everyone · Guests · Signed in · Members — SHALL narrow every number on the dashboard and on Content analytics to that audience (a member: an account with a live subscription at the time of reading). Countries SHALL be shown only as the host reports them (the door's geo header) — *unknown* where it does not — beside the time zones. Every row of Acquisition and Audience SHALL be a **filter**: a channel, a referrer, a campaign, an entry page, a device, browser, system, country or language clicked becomes a chip beside the range, every number on the dashboard and on Content analytics narrows to the chips together, and a chip clears. A **Source** filter — This site · each registered source — SHALL narrow the dashboard to one source's events; Content analytics is this site's alone. Audience SHALL show **Retention**: the browsers first seen in each of the last eight weeks, and of them the share seen again in each later week, as a grid. An **Events** tab SHALL list every event name sent in the window — a registered event by its label, another by its name — with its count, people, count per session, a series a day, the channels it came by, and its top property values; a registered **goal** SHALL stand with sign-ups, purchases and memberships on the Overview (count, rate per hundred visitors, against the window before) and per channel on Acquisition, and every registered event SHALL be a metric in Explore, which SHALL also draw for one channel or one source. A **bounce** SHALL be a session of one page view that lasted under ten seconds.

#### Scenario: the dashboard's tabs

- **WHEN** Dashboard → Analytics opens
- **THEN** the tab row reads Overview · Acquisition · Audience · Content · Commerce · Experiments · Explore, one view at a time, the last chosen one remembered on the next visit

Verified by: `build/interaction.test.mjs` — a tab that is not the first is chosen, the admin is left and re-entered, and that tab must still be the one marked; picking the first would pass by landing on the default

#### Scenario: a channel that converts

- **WHEN** the seed holds sessions that arrived from a search engine, from a social site, direct, from a tagged email link and from another site, some of which signed up in the session
- **THEN** Acquisition lists the six channels with each one's visitors, sessions, bounce, sign-ups and rate, the referrers grouped under their channel, the email campaign under Campaigns; the sessions across channels sum to the Overview's sessions and the sign-ups across channels to the sign-ups credited to a session (a sign-up made with no session on record is in the count and under no channel; a browser that came by two channels is a visitor in each)

Verified by: `analytics.test.mjs`, the channel rule on fixed referrers and tags; `admin_kpis` over the seed compared with the rows in the same test

#### Scenario: the audience filter

- **WHEN** the filter is set to Members
- **THEN** every tile, series and list on the dashboard and on Content analytics counts only sessions and reads of accounts with a live subscription, and the range line says so

Verified by: the same test calling the reads with each audience and checking the sums partition Everyone; the page screenshotted with Members on

#### Scenario: right now

- **WHEN** two browsers have written an event in the last five minutes
- **THEN** the head says 2 on the site now, and Content analytics' Reading now strip names the pieces they are on

Verified by: `admin_now` in the kit test with rows written just before; the strip screenshotted

#### Scenario: click to filter

- **WHEN** Search is clicked on Acquisition and then Phone on Audience
- **THEN** two chips stand beside the range, every tile, list and series on the dashboard and on Content analytics counts sessions that came by search on a phone, the Acquisition table's sessions sum to the Overview's, and clearing the chips restores the whole

Verified by: `analytics.test.mjs` (`admin_kpis` with filters partitioning the unfiltered sessions); the chips screenshotted

#### Scenario: a site's own goal

- **WHEN** the demo's config registers `{ key: 'newsletter_signup', label: 'Newsletter sign-up', goal: true }` and the seed carries such events
- **THEN** the Overview's goals row shows *Newsletter sign-up* with its count and rate, Acquisition's table has its column, the Events tab lists it by its label, and Explore offers it as a metric

Verified by: the demo screenshotted; `analytics.test.mjs` reading `admin_kpis` with the registered goals passed in

#### Scenario: retention

- **WHEN** the seed holds browsers first seen over eight weeks, some back in later weeks
- **THEN** the grid's first column is each week's cohort size and each later cell the share seen again, recomputed from the rows in the test

Verified by: `analytics.test.mjs` (`admin_retention` against the rows); the grid screenshotted

#### Scenario: the Support chat section

- **WHEN** a funnel with a chat step opens on Engagement → Analytics
- **THEN** its step shows prompts shown, picked, begun and per choice its count — no thread text — and Content analytics has no Support chat tab

Verified by: the admin locally, both pages screenshotted (no pinned test)

### Requirement: Content analytics reads what is read

Opening a piece of content SHALL write a `content_view` (kind, id, title, tags, topic slugs) and leaving it — the next piece, a page view elsewhere, the tab hidden, the page gone — a `content_read` carrying the seconds it held the reader — the tab visible and the person at the keyboard: a pointer, key, scroll, touch or wheel signal within the last minute; a minute without one stops the clock at that minute's end, the next signal starts it again; never a cap — and the furthest the viewport's foot reached as a share of the page (0–100). `admin_content(days, audience)` SHALL summarise the window against the window before it — views, readers, **engaged minutes** (the sum), average seconds, the share of reads that reached 90%, **recirculation** (the share of views followed in the same session by another piece), pieces, signed-in readers; a series a day over both windows; per piece views, readers, engaged minutes, average seconds, depth, recirculation and the previous window's views; rising, fading and **evergreen** pieces (published more than a month ago and still among the most read); views by kind, topic, tag and, where pieces carry one, **author**; where reads ended in four bands; the channels and referrers — and refuse anyone not an administrator. Dashboard → Content analytics SHALL show exactly that, in the dashboard's idiom, as tabs — Overview (the numbers, the line, a *Reading now* strip of the pieces with a reader in the last five minutes, rising, fading, evergreen, by kind), Conversions (every sign-up, subscription and paid purchase in the window credited to the last piece its person opened in the seven days before — last touch, by the anonymous ids the account's events carry; content-led of all, and the pieces that led to them), Pieces (the table, filtered by kind and searched by title, with author, engaged minutes and recirculation among its columns), Authors (where pieces carry them: views, readers, engaged minutes, conversions per author), Topics & tags, Readers (depth, channels and referrers), then the finder when the site has it and the site's own panels — one tab shown at a time, the tab remembered per browser; the support prompts are the funnels' and are read on Engagement → Analytics, never here. **Every piece SHALL open its own page** (`admin_piece(kind, id, days, audience)`): views, visitors, engaged minutes, average time, read to the end, recirculation, each against the window before; views a day since it was published; its channels and referrers; devices; new against returning readers; where reads ended in ten bands; *what they read next* (the pieces opened after it in the same session, by how often); and the sign-ups, memberships and purchases credited to it with their revenue and, for each, the channel the person arrived by. Every series over time on every analytics page SHALL be drawn as bars unless the person switches to a line (one choice for all the pages, remembered per browser); a reference series stays a dashed line. The forms' numbers are Forms → Analytics, never on the content page — an index of forms, then one form's own results (the numbers, a series, the steps as a funnel with what each lost, every question in order with its answers counted), never every form's answers on one page.

#### Scenario: a read is one per session and piece

- **WHEN** a reader opens a piece, hides the tab, returns, walks away for ten minutes, comes back and leaves
- **THEN** one `content_read` per leaving is written, its seconds excluding the hidden time and the away time beyond the first idle minute, and `admin_content` sums the segments of one session on one piece into one read and keeps its deepest point

Verified by: `build/reads-db.test.mjs` — against the stack, as an administrator (the service role is refused, which is the function working): the page is asked, one session is written in three segments on a real piece, and the page is asked again. The reads must go up by exactly ONE, the depth must not fall, and the minutes must grow. Removing the fold makes it go up by three and fails it.

#### Scenario: a sign-up after a read

- **WHEN** a browser opens a piece and the account made on it ten minutes later is the browser's (its events carry the account)
- **THEN** `admin_content` credits the sign-up to that piece, and a sign-up whose browser opened nothing in the seven days before counts in the total alone

Verified by: the demo's and a site's seeds (accounts made after reads, a purchase and a subscription for some) and the Conversions tab looked at locally (no pinned test)

#### Scenario: recirculation

- **WHEN** a session opens piece A, then piece B, then leaves, and another session opens piece A alone
- **THEN** A's recirculation is 50%, B's 0%, the page's 33% (one of three views went on), and A's page lists B under *what they read next*

Verified by: `analytics.test.mjs` with those rows written and read back through `admin_content` and `admin_piece`

#### Scenario: a piece's page

- **WHEN** a piece in the seed with sixty days of reads is opened from the table
- **THEN** its page shows the six numbers against the window before, the daily views since it was published, channels, devices, new against returning, the ten depth bands, what was read next and what it led to — and a piece with no reads in the window says so in one line

Verified by: the page screenshotted on the demo, both themes, 1280 and 390

#### Scenario: not an administrator

- **WHEN** a reader who is not an administrator calls `admin_content`
- **THEN** it is refused (`42501`)

Verified by: `build/doors-db.test.mjs` — a guest and a member each call `admin_kpis`, `admin_events` and `admin_retention` and get nothing, and an administrator does get an answer, so a function that refused everybody would not pass

### Requirement: The best seller is computed, never a field

`build/sales.mjs` SHALL read the paid purchases of the last ninety days by book at build time into `.velite/sales.json`; the storefront's Bestseller badge follows it and is never a product field; with no sales there is none.

#### Scenario: no sales

- **WHEN** the purchases table has no paid rows
- **THEN** no card wears the badge and the hero stands the longest featured book in the middle

Verified by: `build/sales.test.mjs` — the compile run from a directory with no `.env` (clearing the environment is not enough: it loads its own) names no best seller and says why, which is the path a fresh clone takes; a badge on a book nobody bought is a lie told in the shop window to the one person with no sales to check it against. Against the stack it also holds that the count is per BOOK across its offers, and that neither a sale older than ninety days nor a refund counts.

### Requirement: Experiments convert on their goal

An exposure SHALL be recorded once per session; the goal is a pageview of the goal path or, for an ad experiment with no goal, a click on the ad; `experiment_converted` is the SQL of it.

#### Scenario: a second visit in one session

- **WHEN** the same visitor sees the variant twice in a session
- **THEN** one exposure is counted

Verified by: NOT VERIFIED — needs a browser. `expose()` is once per session per experiment by way of `sessionStorage`, which is the thing being tested; under Node there is no session to have twice.

### Requirement: Placement in PlatformKit

**Module switch:** analytics (always on).

**Layers.** core: events, the type registry, the dashboards' reads, the best seller. theme: the dashboard screens. site: its event types and panels.

**Extension points this needs:** event types registered (`analytics.events` in the config — a key, a label, goal, value — shown as goals and metrics by the kit's dashboard; the database checks a name's shape, not a list), sources registered (`analytics.sources` — the drop-in script's keys and hosts), panels registered.

**What the kit's module leaves to its comparable, on purpose:** Mixpanel and PostHog: no funnels analysis, no session replay, no click autocapture, no feature flags or surveys (the drop-in answers them as no-ops); a reader is never listed.

This capability SHALL land in the layers above, SHALL be switched by its module, and SHALL expose the extension points named; a site SHALL keep its side as registrations, never as patches.

#### Scenario: a module's events

- **WHEN** a module's events
- **THEN** a module off writes no events of its own and its panel is absent

Verified by: the kit's CI against the demo, and the representative site fixture remains visually unchanged after the change

### Requirement: Funnel analytics

Engagement → Analytics SHALL read what the funnels and the blasts did, as an index and then one funnel or blast at a time, in the dashboard's idiom, for administrators alone (`42501` to anyone else), and SHALL never list a person or an address.

**The index** SHALL show, for the window chosen (7, 30, 90 days) against the window before it: emails sent, the open rate, the click rate, unsubscribed (the count and its rate of sent), conversions and revenue (below); sent, opened and clicked a day, drawn as every other series; then a card per funnel (its title, its steps, in it now, completed, sent · opened · clicked · unsubscribed in the window, conversions, revenue, the last send) and a card per blast (sent, opened, clicked, unsubscribed, conversions, revenue, when it went), each opening its own page; how many people are reachable and how many have opted out, in one quiet line. A window with nothing sent SHALL say so in one line, never a grid of zeros.

**One funnel** SHALL show its tiles against the window before — entered, in it now, completed (of everyone who ever entered), sent, open rate, click rate, unsubscribed, goal reached when the funnel names a goal, conversions, revenue — a series a day of entered, sent, opened and clicked, and **the journey**, which follows the people who entered the funnel in the window however far its emails have carried them since (a blast's: everyone sent it in the window), so a later step never outnumbers the one before it: every step in order, an email step with how many of them were sent it, opened it, clicked it, reached the goal and unsubscribed on it, each count against the step before as a share, and the conversions credited to its sends; between two steps how many are *waiting* for the next (sent the last, its `after` not yet run out), *held* (its `after` run out and nothing sent: the cooldown or no longer in the audience), and *left the audience* (in the funnel, not done, and no longer matching its rules now); after the last step how many completed. A chat step SHALL show shown, picked, threads begun and every choice by how often it was picked, as the Support chat section did. Opening a step SHALL show its links by destination (clicks and people), when it is opened as hour of the day by day of the week, the median time from send to first open, the share of opens on a phone, and — when more than one version of the step has gone out — each version's sent, opened and clicked. A funnel that has sent nothing SHALL say so.

**A blast** SHALL show the same one-step reading on the same page.

**Conversions** SHALL be last touch by email: a paid purchase, a subscription, or a page view of the funnel's or blast's goal by a person in the seven days after an email was sent to them SHALL be credited to the last email of that funnel or blast the person clicked in those seven days, else the last they opened, else none; revenue is the credited purchases' amount. A person who converted with no email before it counts nowhere on this page.

The page SHALL carry one quiet line saying opens are overcounted by mail clients that fetch images ahead and clicks are the truer number, and SHALL not show delivery or bounces.

#### Scenario: the journey of a three-step funnel

- **WHEN** the seed holds a funnel of three emails with people at every place in it — some sent all three, some waiting for the second, some overdue for it, some who no longer match its rules, some unsubscribed on the second — and the funnel's page opens on the 90-day window
- **THEN** the journey shows, for the people who entered in the window, the three steps' sent · opened · clicked · unsubscribed with the second's counts as shares of the first's, the waiting and held between the first and second, the ones who left the audience, and the completed at the end — every count equal to what the seed wrote

Verified by: a kit test of `admin_funnel` over the local stack's seed (the counts recomputed from the rows in the test); the page screenshotted in both themes, 1280 and 390

#### Scenario: a purchase after a click

- **WHEN** a person is sent two emails of a funnel, clicks the first, opens the second, and buys a book four days after the second
- **THEN** the purchase and its amount are credited to the first email (the last clicked), once, and to the funnel's tile

Verified by: the same kit test, with the seed's rows

#### Scenario: an unsubscribe at the second email

- **WHEN** a person opens the unsubscribe link at the foot of a funnel's second email
- **THEN** the profile is opted out as before and the second step's row shows one unsubscribed, the first's none

Verified by: a kit test calling `email-unsubscribe` against the served functions with a seeded send; the journey row looked at

#### Scenario: not an administrator

- **WHEN** a reader who is not an administrator calls the funnel reads
- **THEN** they are refused (`42501`)

Verified by: `policies.test.mjs`'s read-through of the admin functions

#### Scenario: nothing sent

- **WHEN** the index opens on a site whose funnels have sent nothing in the window
- **THEN** one line says so, the cards still list every funnel with its people in it, and no tile is a grid of zeros

Verified by: the demo with its seed's sends older than the 7-day window, screenshotted
