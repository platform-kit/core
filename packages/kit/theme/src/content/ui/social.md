---
scope: social
title: Social publishing
---

## page

### main

title: Social publishing
lead: Plan social posts, manage connected accounts and review publishing activity.
nav-publish: Publishing
nav-engage: Engage
nav-insights: Insights
nav-manage: Manage
calendar-overview: Social publishing overview
metric-scheduled: Scheduled targets
metric-drafts: Drafts
metric-accounts: Connected accounts
loading: Loading social publishing…
request-failed: Social publishing could not load. Try again.
workspace-navigation: Social publishing views
calendar-tab: Calendar
drafts-tab: Drafts
posts-tab: Posts
comments-tab: Comments
analytics-tab: Analytics
inbox-tab: Inbox
explore-tab: Explore
accounts-tab: Accounts
settings-tab: Settings
calendar: Calendar
settings-description: Manage provider connections and who can publish.
timezone: Time zone
calendar-settings-title: Calendar preferences
calendar-settings-description: Choose the time zone used to display the calendar and prefill new post schedules.
calendar-view: Calendar view
month: Month
week: Week
new-post: New post
previous-period: Previous period
next-period: Next period
today: Today
calendar-empty: Nothing is scheduled in this calendar yet.
new-post-for: Schedule a post for
media-post: Media post
target-error-line: {account} — {reason}
drafts: Drafts
drafts-description: Posts not currently scheduled.
drafts-empty: No drafts yet.
draft-saved: Draft saved.
post-scheduled: Post scheduled.
schedule-cancelled: Scheduled targets cancelled.
cancel-confirm: Cancel every pending target for this post?
delivery-title: Delivery status
delivery-target: {account}
retry-delivery: Retry this target
retry-confirm: Retry publishing this target?
confirm-not-published: Check the social account first. Retry only if you have confirmed this post is not already published.
mark-published: Mark as published
provider-post-id: Enter the post ID shown by the social platform:
delivery-recovered: Delivery state updated.
oauth-finished: Account connection finished.

### posts

title: Posts
description: Browse every site post, delivery state, schedule and provider publication from one workspace.
col-post: Post
col-updated: Updated
col-scheduled: Scheduled
col-accounts: Accounts
col-delivery: Delivery status
draft-label: Draft
selected-post: Selected post
edit: Edit
deliveries: Delivery targets
provider-post: Provider post
view-comments: Comments
view-analytics: Analytics
delivery-details: Delivery details
no-deliveries: This post has no delivery targets.
select-post: Select a post to see its delivery details.
provider-posts: Provider posts
provider-posts-unavailable: This account does not provide a post-listing capability.
provider-empty: No provider posts were returned.
provider-detail: Provider post details
select-provider-post: Select a provider post to inspect it.
remove-confirm: Remove this published post from the selected social account?
refresh: Refresh

### comments

title: Comments
description: Browse comments on published posts and reply in context.
choose-post: Published post and account
empty-comments: No comments were returned for this post.
selected-comment: Selected comment
reply: Reply
send-reply: Send reply
select-comment: Select a comment to reply.

### analytics

title: Analytics
description: Browse saved post metrics and freshness alongside account performance.
choose-post: Published post for post metrics
all-posts: All published post snapshots
account-metrics: Account performance
history-title: Saved metric snapshots
date-filters: Filter saved snapshots by collection date
no-snapshots: No saved metric snapshots match these filters. Supabase collects published-post metrics automatically.
no-snapshots-in-range: No saved snapshots fall within those dates.
collection-cadence: Supabase collects metrics hourly for the first 72 hours after publication, then daily. These dates filter saved snapshots only.
snapshot-at: Collected
last-fetched: Last successful fetch
next-fetch: Next scheduled fetch
not-fetched: Not yet fetched
fetch-state: Collection state
fetch-attempts: Collection attempts
last-error: Last collection error
provider-metrics: Provider metrics
state-pending: Waiting for first collection
state-fetching: Collection in progress
state-available: Metrics available; collection is scheduled
state-unsupported: Not supported by this account
state-error: Collection will retry
date-from: From
date-to: Through
analytics-unavailable: Analytics are not available for this account.
metric-impressions: Impressions
metric-reach: Reach
metric-engagement: Engagement
metric-clicks: Clicks
metric-views: Views
metric-likes: Likes
metric-comments: Comments
metric-shares: Shares

### inbox

title: Inbox
description: Read account conversations and notifications, then act on the selected record.
inbox-mode: Inbox view
messages: Messages
notifications: Notifications
empty-messages: No conversations were returned.
empty-notifications: No notifications were returned.
select-record: Select a record to see its details.
reply: Reply
send-reply: Send reply
mark-seen: Mark notifications as seen through this record

### explore

title: Explore
description: Search posts, look up profiles and browse account relationships.
explore-mode: Explore view
search: Search
profiles: Profiles
following: Following
followers: Followers
blocked: Blocked
muted: Muted
search-posts: Search posts
profile-handle: Profile handle
lookup-profile: View profile
empty-results: No records were returned.
select-record: Select a record to see its details.
unnamed-record: Social record

### oauth

connected: Social account connected.
state_invalid: The account connection could not be verified.
state_unavailable: The account connection could not be completed.
state_mismatch: The account connection belonged to another session.
state_replayed: This account connection has already been used.
state_expired: This account connection has expired. Start again.
authorization_denied: The social account authorization was declined.
connection_failed: The social account could not be connected.

### status

scheduled: Scheduled
claimed: Preparing
publishing: Publishing
remote-scheduled: Scheduled with provider
published: Published
retry_wait: Retry waiting
failed: Failed
blocked: Blocked
review-required: Needs review
cancelled: Cancelled

## accounts

### main

title: Connected accounts
description: Every authorized publisher can schedule to these accounts.
empty: No social accounts are connected.
no-account-selection: No accounts connected
connect: Connect
disconnect: Disconnect
disconnect-confirm: Disconnect this social account? Pending posts will no longer be deliverable.
provider-settings: Provider setup
provider-settings-description: Add the provider application credentials in Supabase-backed storage. They are never shown again.
bluesky-provider-setup: Bluesky uses a public OAuth client document served by this Supabase project; no client secret is needed.
bluesky-login-hint: Enter the Bluesky handle, DID, or server URL to connect:
provider: Social platform
client-id: OAuth client ID
client-secret: OAuth client secret
save-provider: Save provider credentials
provider-saved: Provider credentials saved.
configure-first: An administrator must configure a provider before connecting an account.
media-preview-failed: A media preview could not be prepared.
managed-backend: Managed backend
start-managed-connection: Connect account
backend-saved: Managed backend credentials saved.
managed-backend-settings: Managed publishing backends
managed-backend-settings-description: Add an API key for a managed Social SDK backend. Account credentials stay in Supabase Vault.
managed-api-key: Backend API key
managed-webhook-secret: Optional webhook verification secret
save-managed-backend: Save backend credentials
managed-secrets-write-only: Secrets are never returned to this page. Leave the optional webhook secret empty to keep the existing value.

### backends

zernio: Zernio
post-for-me: Post for Me
postfast: PostFast

### operations

details: Account details
hide-details: Hide details
loading-details: Checking available features…
available-workspaces: Available Social workspaces
no-workspaces: This account has no additional supported Social workspaces.
operation-failed: This account operation could not be completed.
operation-accounts-read: Account profile
operation-posts-read: Provider posts and delivery status
operation-media-upload: Upload saved media
operation-search-posts: Search posts
operation-analytics-account-read: Account analytics
operation-analytics-read: Post analytics
operation-analytics-report-read: Analytics report
operation-profiles-read: Read a profile
operation-graph-read: Read relationships
operation-graph-follow: Follow profile
operation-graph-unfollow: Unfollow profile
operation-graph-block: Block profile
operation-graph-unblock: Unblock profile
operation-graph-mute: Mute profile
operation-graph-unmute: Unmute profile
operation-comments-read: Read comments
operation-comments-write: Reply to a comment
operation-messages-read: Read messages
operation-messages-write: Send a message
operation-notifications-read: Read notifications
operation-notifications-seen: Mark notifications as seen
operation-posts-cancel-scheduled: Cancel a scheduled post
operation-posts-delete-backend-record: Delete a backend record
operation-posts-remove-from-platform: Remove a published post
operation-webhooks-verify: Verify a webhook signature
operation-webhooks-decode: Decode a webhook event

### status

connected: Connected
reconnect-required: Reconnect required
disconnected: Disconnected

## access

### publishers

title: Publisher access
description: Invite a person by email, then explicitly grant their Social actions and account access.
email: Email address
invite: Send invitation
invitation-sent: Invitation sent.
revoke: Revoke access
revoke-confirm: Revoke this person's social publishing access now?
no-publishers: No publishers have been invited.
settings-navigation: Social settings sections
provider-settings-tab: Provider setup
publisher-access-tab: Publisher access
calendar-settings-tab: Calendar
configured-accounts: Permissions configured for {count} accounts
not-configured: No account permissions assigned
permissions-for: Permissions for
explicit-grants-only: Access is granted account by account. Existing publishers receive no automatic permissions.
manage-accounts: Manage connected accounts
manage-accounts-description: Allow this publisher to connect, refresh and disconnect social accounts.
account: Social account
read-posts: Read posts and calendar
create-posts: Create drafts
edit-posts: Edit posts
schedule-posts: Schedule posts
approve-posts: Approve posts
publish-now: Publish now and recover deliveries
view-results: Read results and analytics
no-accounts: No social accounts are connected.
save-permissions: Save permissions
permissions-saved: Publisher permissions saved.
approval-required: Requires approval
approval-setting: Require approval before posts are published
approval-required-saved: Posts for this account now require approval.
approval-not-required-saved: Approval is no longer required for this account.
approvals-tab: Needs approval
approvals-title: Needs approval
approvals-description: Review each account target before it can be published.
approvals-empty: Nothing is waiting for approval.
immediate-intent: Publish as soon as this target is approved
scheduled-intent: Scheduled for {time}
approve: Approve
return-to-draft: Return to draft

### status

pending: Invitation pending
active: Active
revoked: Revoked
expired: Expired

## editor

### compose

title: New social post
new-draft: New draft
edit-title: Edit social post
description: Write the post, attach media, select accounts and choose a time.
close: Close composer
text: Post text
media: Media
add-media: Add images or video
media-help: JPEG or PNG images up to 5 MiB, or MP4 video up to 100 MiB.
save-before-media: Save this draft before adding media.
move-media-up: Move media earlier
move-media-down: Move media later
replace-media: Replace media
remove-media: Remove media
accounts: Publish to
no-connected-accounts: Connect at least one account before scheduling.
publish-at: Publish at
timezone: Time zone for this schedule
select-account: Select at least one connected account.
time-invalid: Choose a valid future time in the selected time zone.
reddit-options: Reddit post settings
reddit-subreddit: Subreddit
reddit-title: Post title
reddit-text-only-help: Reddit currently supports text-only self posts here. Remove media before selecting Reddit.
save-draft: Save draft
schedule: Schedule post
cancel-schedule: Cancel pending targets
delivery-locked: A target is being delivered, has finished, or needs recovery. Resolve its delivery before changing the post.

## automations

### main

title: Automations
description: Set account-specific keywords to draft bot replies to comments or direct messages.
account: Social account
no-accounts: No account with View results access is available.
rules-tab: Rules
responses-tab: Responses
rules-title: Response rules
rules-description: Match an incoming comment or direct message to a bot response.
new-rule: New rule
new-rule-title: New response rule
edit-rule: Edit response rule
no-rules: No automations for this account yet.
select-rule: Set the trigger, bot, destination and delivery mode.
event: Incoming interaction
comment-event: Comment
dm-event: Direct message
keyword: Keyword or phrase
bot: Bot
destinations: Where the response goes
public-destination: Public comment reply
public-explanation: Visible to everyone on the social platform
private-destination: Private direct message
private-explanation: Visible only to the recipient
mode: Response mode
mode-review: Draft for review
mode-automatic: Send automatically
automatic-warning: Future matching replies are sent without review. Use automatic mode only for responses that are safe to send as written.
enabled: Rule enabled
paused: Rule paused
save-rule: Save rule
saving: Saving…
cancel-edit: Cancel
saved: Automation saved.
rule-save-failed: Could not save this automation.
no-routes: This account has no verified inbound event and reply route for automations.
route-unavailable: The provider route could not be verified. This account cannot create or enable a rule right now.
read-only: View only
no-bots: No published Social bots are available for anonymous provider authors.
responses-title: Response history
no-responses: No bot responses for this account yet.
select-response: Select a response to review its triggering interaction and available conversation history.
loading: Loading automations…
load-failed: Could not load Social automation history.
options-failed: Could not verify automation capabilities for this account.
trigger: Triggering interaction
context: Available conversation history
no-context: No earlier messages are available for this interaction.
connected-account: Connected account
other-participant: Other participant
response: Bot response
response-state: Response status
draft-status: Awaiting review
queued-status: Queued for automatic delivery
generating-status: Generating
sending-status: Sending
sent-status: Sent
failed-status: Failed
uncertain-status: Outcome uncertain
discarded-status: Discarded
public-label: Public reply
public-visibility: Everyone on the social platform can see this reply.
private-label: Private DM
private-visibility: Only the recipient can see this message.
edit-response: Edit response
send-response: Send reply
discard-response: Discard draft
response-sent: Response sent.
response-discarded: Draft discarded.
response-action-failed: Could not update this response.
response-text: Response text
response-history: Recent responses
empty-text: No response text was generated.
last-error: Delivery note
