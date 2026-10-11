# A relay of your own

Two people in a call who cannot reach each other directly need a relay. The kit never depends on
one: give it a URL and a secret and it mints the credentials itself, in the standard's own terms, so
the same setting points at this compose file or at any hosted relay that speaks TURN.

```
docker compose -f deploy/relay/docker-compose.yml up -d
```

Then, wherever the site's secrets live:

```
WEBRTC_TURN_URL=turn:relay.your-site.example:3478
WEBRTC_TURN_SECRET=the-same-secret-as-TURN_SECRET
```

`TURN_SECRET` and `TURN_REALM` are read from the environment the compose file runs in. The secret is
shared between this box and the site's function and nothing else; nobody's name, address or account
ever reaches the relay, because the standard's credentials are a timestamp and a hash.

**Ports.** 3478 for the relay itself and 49160–49200 for what it relays — widen the range for a busy
site. It runs on the host's own network because a relay needs its own ports rather than a bridge's.

**What it costs.** A relayed 720p call is roughly 0.9–1.35 GB an hour, and only some calls need
relaying at all — the rest connect directly and never touch this. A small machine with ordinary
bandwidth carries a surprising number of them.

**Without it**, every call that does not need relaying still happens, which is most of them, and the
rest say plainly that they cannot be made. That is the honest default, and it is why nothing here is
required.
