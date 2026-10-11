# Proposal

## Why

The two overview documents now include community and social-network comparables that `kit-principles` does not yet describe, so the documentation guard fails. The corresponding `network` module and atproto surfaces already exist in PlatformKit; this change records the documented capability rather than adding runtime behavior.

## What Changes

- Preserve the overview's intentional additions and align the first three table columns in the specification and both overview copies.
- Keep the fourth “what it leaves out” column as documentation prose; no implementation or user-interface behavior changes.

The following exact rows are the intended specification copy:

| Instead of | The kit's module | What it does |
| --- | --- | --- |
| Circle.so, Mighty Networks, Skool, Discourse | spaces, network, memberships | a community for the site's members: the tier that was bought is the membership of the space, channels per book, topic or cohort read as chat, a forum or a feed, the space's feed pinnable in any atproto client, and a member's card showing what they have read, scored and bought |
| Bluesky, Mastodon | network | the site's own social network: every member a page, follows, a timeline, posts with likes, reposts, replies and quotes, each post to everyone, to the site's own people or to a space's members — closed to the site's people by default, joined to Bluesky's network by the site's switch and each member's consent — the whole of it served as an atproto server and app view, so Bluesky's app and any atproto client sign in with the host swapped |

**Non-goals:** No new network capability, interoperability claim, or change to the fourth-column limitations.

**Review focus:** Confirm these rows belong to PlatformKit's generic comparables and that the exact first three columns match in all three records.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kit-principles`: Specify the existing community and social-network comparable rows.

## Impact

The `kit-principles` specification and the two overview documents are affected. Verification uses `docs-check.mjs`; the existing network and atproto implementation is represented by the `network` module and its tests.
