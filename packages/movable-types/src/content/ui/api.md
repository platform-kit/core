---
scope: api
---

## page

### head

title: API
subtitle: API keys and endpoints for this site.
space: Space
environment: Environment
base: Base
docs: How to read it
signin-heading: Sign in to manage the keys
signin-subtitle: The keys are for administrators.
signin-cta: Sign in
denied-heading: For administrators only
denied-subtitle: This account is not an administrator.
public-on: Delivery is public on this site: published content reads without a key. A key still counts its own use and may read gated content.
public-off: Delivery needs a key on this site.

### keys

heading: Keys
none: No keys yet. A Contentful client sends one with every request; make one for each place that reads.
new: New key
name: Name
name-placeholder: The site that will use it
kind: Kind
delivery: Delivery
delivery-hint: published content
preview: Preview
preview-hint: drafts and unpublished entries
management: Management
management-hint: writes
forms: Forms
forms-hint: responses and webhooks of the forms
scheduling: Scheduling
scheduling-hint: the sessions: open times, bookings, webhooks
storefront: Storefront
storefront-hint: products, collections and carts for a headless storefront
support: Support
support-hint: the desk: conversations, replies, contacts, webhooks
gated: Allow gated content
gated-hint: the body of an entry the site gates to members
create: Create
cancel: Cancel
working: Making the key…
created: Created
last-used: Last used
never: Never
revoke: Revoke
revoke-confirm: Revoke this key? Everything using it stops reading at once.
revoked: Revoked
reveal-heading: Copy the key now — it is not shown again.
reveal-lead: Keep it where the site that uses it keeps its secrets.
copy: Copy
copied: Copied
done: Done
failed: The key could not be made.

### webhooks

heading: Webhooks
lead: Contentful's webhooks: a subscriber told of every publish, save and delete, entries and assets alike.
none: No webhooks yet. A subscription is made through the Management API with a key of kind Management.
name: Name
url: URL
topics: Topics
active: Active
on: On
off: Off
last-delivery: Last delivery
never: Never
failed: Failed

## reference

### head

title: API reference
description: Every route of this site's content API and analytics door, with examples to run.
loading: Loading the reference…
link: Read the reference
back: Back to the site
