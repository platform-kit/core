# Proposal

## Why

When a member joined the wider network and posted within a second or two, the post could be missing from their public repository, so Bluesky never saw it. Three things combined:

- Joining and posting each start an update of the repository. Both read the same saved version, both build a new one, and the saved version was a plain overwrite, so the update without the post could be the one that stayed.
- An update cleared the member's "needs updating" mark before it began, so an update that failed or lost was never tried again.
- A read of the repository could land between a new version being saved and the old version's blocks being let go, and fail to load ("block not found").

## What Changes

- A new version is saved only if it is built on the version currently saved, checked inside the database in one step (`network_commit_swap`). An update that loses rebuilds from the winner's version, up to five times.
- Blocks the new version no longer needs are let go, and the version is told to relays, only after it is saved.
- A read of the repository takes the saved version, then its blocks, then checks the saved version again, and reads again if it moved.
- The "needs updating" mark is cleared only after the update succeeds, and only the mark that update read. A mark made since stays for the next request, and a failed update leaves its mark for the sweep, which runs every five minutes.

## Non-goals

- Changing what is public, or how relays are told.
- The end-to-end stacks' early name lookups: there, the database's first requests to the functions server can fail to resolve its name for about a minute; the interop test then asks for the update as the sweep would. That is the test environment's, not the platform's.
