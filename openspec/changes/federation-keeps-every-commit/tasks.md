## Tasks

- [x] `93-network.sql`: `network_commit_swap(did, user, prev, cid, rev)`, service role only
- [x] `_shared/atproto/federation.ts`: the commit saved through the swap and rebuilt when it loses; blocks let go and the event told only after; `loadRepo` reads a head that held still
- [x] `atproto/index.ts`: the mark cleared after the update, and only the one it read
- [x] `network-db.test.mts`: the swap's five cases, a member refused
- [x] `atproto-interop.test.mts`: where the database's ask has not landed, the test asks as the sweep would; `atproto.test.mts` and it pass under `platformkit test --e2e`
