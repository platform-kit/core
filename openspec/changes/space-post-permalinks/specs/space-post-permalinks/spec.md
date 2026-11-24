## ADDED Requirements

### Requirement: Every space post has its own address

A post in a space room SHALL be at `/spaces/<space>/<room>/<post>`, and opening that address SHALL open the room with the post and its replies. The post's time, Share and a press on its card SHALL lead there, and so SHALL a reply or mention email. Closing the post SHALL return the address to the room.

#### Scenario: a link to a post

- **WHEN** a member opens a space post's address, or presses the post on the community's Home
- **THEN** the room opens with that post and its replies, without a reload when pressed inside the community

Verified by: a member's Home and a pasted post link driven in a browser at 1290 and 390

#### Scenario: an older link

- **WHEN** a member opens a room address carrying `?post=<id>`
- **THEN** the post opens with its replies, and the address becomes the post's own

Verified by: a `?post=` link driven in a browser
