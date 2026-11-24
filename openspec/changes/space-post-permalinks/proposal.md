# Proposal

## Why

A post shared with a space had no address of its own. Its time, its Share button and a press on it all led to the room, so a link sent to somebody landed at the bottom of the channel, and reply and mention emails pointed at `/channels/<id>`, an address the site no longer answers. Network posts already had a page each (`/feed/post/<id>`); space posts, which a private community is mostly made of, did not.

## What Changes

- A space post is at `/spaces/<space>/<room>/<post>`: the room opens with that post and its replies open. Refresh, the back button and a pasted link all return to it; closing the post returns the address to the room.
- The post card in the feed and on Home, its time, Share in the feed and Share in the room all use the post's address, for either kind of post. A press on the card moves the page without reloading it.
- Reply and mention emails link to the post.
- A link in the old `?post=<id>` form opens the post.
- On a phone the post and its replies take the whole screen, clear of the bottom bar.

## Capabilities

### New Capabilities

- `space-post-permalinks`: every space post has an address that opens it with its replies.
