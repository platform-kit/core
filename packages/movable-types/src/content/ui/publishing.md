---
scope: publishing
---

## page

### head

title: Publishing
subtitle: Review drafts and publish them to the live site.
subtitle-off: Save keeps a draft; visitors see the live version until you publish. Publishing puts every draft on the site at once. There is no repository here, so these rows are the only copy of the content.
signin-heading: Sign in to publish
signin-subtitle: Publishing is for administrators.
signin-cta: Sign in
denied-heading: For administrators only
denied-subtitle: This account cannot publish.
git-mode: Every save writes a file in your working tree, to commit and push yourself. There are no drafts on this site.
loading: Reading…
rail: Publishing

### drafts

heading: Drafts
waiting: {n} waiting
waiting-one: 1 waiting
empty: Nothing drafted — the site is what the editors saved.
removed: removed
new: new
by: {who}, {when}
keep: Keep
message: Message
message-placeholder: Publish: {n} pages
message-placeholder-one: Publish: 1 page
publish-all: Publish everything
publishing: Publishing…
published: Published {n}.
published-one: Published 1.
failed: Could not publish.
checks: {name} would not save: {issue}

### form

heading: The repository
repo: Repository
repo-hint: owner/name on GitHub
from-config: Declared in platformkit.config.js — this site publishes where the repository says.
branch: Branch
token: Token
token-hint: A fine-grained token with read and write on this repository's contents. Leave blank to keep the one already set.
token-set: A token is set.
token-none: No token yet — what is published is live on the site and waits here until a repository is set.
save: Save
saving: Saving…
saved: Saved.
failed: Could not save the settings.

### status

heading: The pushes
connected: Connected — every publish goes to {repo} on {branch} as one commit.
disconnected: Not connected: set the repository and a token above.
last-push: Last push {when}.
never: Nothing pushed yet.
pending-none: Nothing waiting.
pending-some: {n} waiting to be pushed.
error: The last push failed: {error}
retry: Push now
retrying: Pushing…
retried: Pushed {n}.

### rebuild

heading: The rebuild
why-git: A publish is live on the site at once. The pages a crawler is served, and the pictures a link shows, are the last build's until the host builds again — which the commit usually does. Set a hook if yours does not.
why-off: A publish is live on the site at once. The pages a crawler is served, and the pictures a link shows, are the last build's until the host builds again. With no repository, nothing asks it to — so give it a hook, or the two will drift apart.
hook: Deploy hook
hook-hint: The URL your host gives you to start a build
hook-set: A hook is set.
hook-none: No hook — nothing asks the host to build.
last: Last asked {when}.
never: The host has not been asked yet.
ask: Rebuild now
asking: Asking…
asked: The host was asked to build.
failed: The host could not be asked: {error}

### copy

heading: A copy of the content
why: Every page as its file, as one zip — what a checkout of this content would look like. It is a copy and not a record: there is no history in it, nothing to compare two days with, and no way back to a single page as it was. A deployment that wants those attaches a repository.
take: Download the content
taking: Gathering…
failed: Could not make the copy: {error}
