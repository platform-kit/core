## ADDED Requirements

### Requirement: A form is a forms.md document

The `forms` module SHALL hold each form as a forms.md document under `content/forms/`, edited in a builder that never shows the grammar, and run by the kit's own runner in the site's design. Its field types SHALL be text, email, URL, phone, password, number, dropdown, multiple choice, picture choice, rating, opinion scale, date, time, date and time, file, voice and video, with validation, conditions, branching and progress.

#### Scenario: the vendored grammar

- **WHEN** forms.md's own tests run over the parts of it the kit vendored
- **THEN** they pass unchanged

Verified by: `build/forms.test.mjs`

### Requirement: Every answer is kept as it is given

Every answer SHALL be saved as a row as it is given, with files in a bucket, and a reader SHALL be able to resume an unfinished form. A form MAY require sign-in, allow one answer per person, or be closed. Values in the form's link SHALL be saved with the response.

#### Scenario: an answer belongs to its respondent

- **WHEN** a respondent reads responses
- **THEN** they read only their own

Verified by: `build/ownership.test.mjs` under `platformkit test --e2e`

### Requirement: Paid forms, scores and tickets

A paid form SHALL take the price at checkout first, and each purchase SHALL buy one response. A quiz-style form SHALL be scored, and a completed form MAY raise a support ticket with its title and priority taken from the answers.

#### Scenario: a passed quiz finishes its lesson

- **WHEN** a response to a scored form passes
- **THEN** every open course lesson pointing at that form is recorded done for the respondent

Verified by: `build/courses-db.test.mjs` under `platformkit test --e2e`

### Requirement: Webhooks and the Typeform API

A completed response SHALL be delivered to the form's webhooks, signed and retried on failure. The forms SHALL be served over Typeform's Create (read, and write in cloud mode), Responses, Webhooks and Insights APIs, with keys, so Typeform's own client works with the base changed.

#### Scenario: Typeform's client

- **WHEN** `@typeform/api-client` lists forms, reads one and its responses
- **THEN** it answers every published form, the served definition has the form's fields, and each response its typed answers

Verified by: `build/forms-api.test.mjs` under `platformkit test --e2e`, `build/webhooks.test.mjs`
