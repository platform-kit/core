# Spec Delta

## MODIFIED Requirements

### Requirement: The deploy is refused before it runs anything

The deploy SHALL check the environment against what the content switches on before it links, pushes, builds or deploys anything, and SHALL refuse with every missing or wrong setting named at once. Anything for sale needs the live credentials and webhook configuration for the selected payment provider; when no provider is selected, Stripe remains the default and requires its live key and webhook secret, while a selected Hyperswitch provider requires its instance URL, API key, business profile, and webhook signing key. A book in print needs a printer for every printed format it sells; a published booking type that cal.com schedules needs cal.com's webhook secret and API key — a site whose every type the site itself schedules needs nothing of cal.com's; a published type whose call happens in the site's video room needs LiveKit's address, key and secret, and — when the type records — the storage keys the room lands the film with; a site whose room types are all links needs nothing of LiveKit's; a mock switched on is refused. **A feature that is off asks for nothing, and that SHALL include the backend itself**: a site with no accounts, nothing for sale, nothing booked and nothing mailed SHALL be asked for no database, no mail relay and no push keys. A site that DOES switch on something needing a backend and has none SHALL be refused by what it has on, in those words, rather than by the name of a missing variable.

#### Scenario: a bare environment

- **WHEN** `DEPLOY=1 node build/deploy.mjs` runs with the target guards satisfied and nothing else set
- **THEN** it prints the missing settings and exits 1 having run no command

Verified by: by hand once per change to the checks

#### Scenario: the rules

- **WHEN** `node build/deploy-checks.mjs --test` runs
- **THEN** every rule passes (`npm test` runs it), the steps' needs among them — a native-only site asks for no `CAL_*`, a site with one cal.com type asks for both; a site with no room type asks for no `LIVEKIT_*`, one room type asks for the three, one that records for the storage keys too

Verified by: `deploy-checks --test`

#### Scenario: a site with nothing on

- **WHEN** the checks run over a site with every module off and an empty environment
- **THEN** nothing is missing: no database, no shadow, no relay, no push pair

Verified by: `deploy-checks --test`, the case added for it

#### Scenario: a feature with nowhere to keep anything

- **WHEN** a site has the store on, or accounts, or a booking type, and no backend is configured
- **THEN** the deploy is refused and says which feature needs one, not which variable is unset

Verified by: `deploy-checks --test`

#### Scenario: a Hyperswitch site does not need Stripe credentials

- **WHEN** a site with something for sale selects Hyperswitch and has all required Hyperswitch settings but no Stripe settings
- **THEN** the provider-specific payment check passes without asking for Stripe credentials

Verified by: `deploy-checks --test`

#### Scenario: a selected Hyperswitch site names every missing setting

- **WHEN** a site with something for sale selects Hyperswitch and one or more required Hyperswitch settings are missing
- **THEN** deployment refuses before running a command and names all missing Hyperswitch settings without asking for Stripe credentials

#### Scenario: a selected Hyperswitch site requires its publishable key

- **WHEN** a site selects Hyperswitch for an enabled commerce feature and its publishable key is missing
- **THEN** deployment refuses before running a command and names `HYPERSWITCH_PUBLISHABLE_KEY`

Verified by: `deploy-checks --test`

#### Scenario: a selected Hyperswitch site has an unsupported publishable-key format

- **WHEN** a site selects Hyperswitch and its publishable key does not use a Web SDK-issued `pk_dev_`, `pk_snd_`, or `pk_prd_` prefix
- **THEN** deployment refuses before running a command and identifies the invalid Hyperswitch publishable key without printing its value

Verified by: `deploy-checks --test`

#### Scenario: a selected Hyperswitch site configures a client SDK URL

- **WHEN** `HYPERSWITCH_CLIENT_URL` is configured for a selected Hyperswitch provider
- **THEN** deployment accepts an HTTPS URL and refuses a non-HTTPS or invalid URL without printing the configured value

Verified by: `deploy-checks --test`
