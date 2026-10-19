/*
 * LiveKit as the site's own video room: the room is named after the booking (a group session's after
 * its seat, so every seat shares one), the app's call page is the address, a person is admitted by a
 * token minted for them and that booking alone (the host with the room's controls), the room is
 * recorded as one film straight into the site's `recordings` bucket by Egress over Supabase Storage's
 * S3 endpoint, and the room's own notifications say when it started, ended and where the film landed.
 * Plain JavaScript on the server SDK (`livekit-server-sdk`, pure JS: jose and protobuf-es), bound to
 * an environment and a database client. Keys: LIVEKIT_URL (wss://…), LIVEKIT_API_KEY, LIVEKIT_API_SECRET;
 * for the recording, STORAGE_S3_ENDPOINT / STORAGE_S3_ACCESS_KEY / STORAGE_S3_SECRET_KEY / STORAGE_S3_REGION.
 *
 * The mock (LIVEKIT_MOCK=1, or no keys at all — local only, the deploy refuses it): a room on a LiveKit
 * server run locally in dev mode (ws://127.0.0.1:7880, the dev pair devkey / secret) so the call page is
 * real, and — since LiveKit Cloud's egress can never reach a local bucket — a recording that "lands" by
 * the mock copying a fixture film into the bucket and posting itself the egress_ended event.
 */
import { AccessToken, WebhookReceiver, EgressClient, RoomServiceClient, EncodedFileType, EncodedFileOutput, S3Upload, EgressStatus } from 'npm:livekit-server-sdk@2'
import { RoomAgentDispatch, RoomConfiguration } from 'npm:@livekit/protocol@1.51.0'

const DEV_KEY = 'devkey', DEV_SECRET = 'secretsecretsecretsecretsecretsecret', DEV_URL = 'ws://127.0.0.1:7880'
const BUCKET = 'recordings'
const BEFORE_MS = 15 * 6e4, AFTER_MS = 60 * 6e4

export function livekit({ db, env }) {
  const configured = () => !!(env('LIVEKIT_URL') && env('LIVEKIT_API_KEY') && env('LIVEKIT_API_SECRET'))
  const mock = () => env('LIVEKIT_MOCK') === '1' || !configured()
  const url = () => (mock() ? DEV_URL : env('LIVEKIT_URL'))
  const key = () => (mock() ? DEV_KEY : env('LIVEKIT_API_KEY')), secret = () => (mock() ? DEV_SECRET : env('LIVEKIT_API_SECRET'))
  /* the server's API from the function: the mock's dev server is on the host, which the edge runtime's container reaches as host.docker.internal */
  const http = () => (mock() ? (env('LIVEKIT_MOCK_API') || 'http://host.docker.internal:7880') : url().replace(/^ws/, 'http'))
  const app = () => (env('APP_URL') || '').replace(/\/$/, '')
  const ref = (b) => b.room || b.seat_of || b.uid
  const s3 = () => ({ endpoint: env('STORAGE_S3_ENDPOINT') || (env('SUPABASE_URL') || '').replace(/\/$/, '') + '/storage/v1/s3', accessKey: env('STORAGE_S3_ACCESS_KEY'), secret: env('STORAGE_S3_SECRET_KEY'), region: env('STORAGE_S3_REGION') || 'us-east-1', bucket: BUCKET, forcePathStyle: true })
  const canRecord = () => mock() || !!(env('STORAGE_S3_ACCESS_KEY') && env('STORAGE_S3_SECRET_KEY'))

  return {
    id: 'livekit', configured, mock, url, canRecord,
    /* the row's Join opens the app's own call page; the room is the booking's (a seat's shared time) */
    room: (b) => ({ join_url: `${app()}/app/call/${b.uid}`, ref: ref(b) }),
    /* a token for this person and this booking: from fifteen minutes before until an hour after; the host with the room's controls */
    async admit(b, person, role) {
      const now = Date.now(), start = Date.parse(b.start_at), end = Date.parse(b.end_at)
      if (now < start - BEFORE_MS) return { early: true, opens: new Date(start - BEFORE_MS).toISOString() }
      if (now > end + AFTER_MS) return { over: true }
      const ttl = Math.max(60, Math.floor((end + AFTER_MS - now) / 1000))
      const at = new AccessToken(key(), secret(), { identity: person.id, name: person.name || person.email || '', ttl })
      at.addGrant({ roomJoin: true, room: ref(b), canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: role === 'host', roomRecord: role === 'host' })
      return { url: url(), token: await at.toJwt(), ttl, room: ref(b) }
    },
    async dispatchAgent({ room, identity, metadata, ttl }) {
      if (!configured()) throw new Error('LiveKit is not fully configured')
      const at = new AccessToken(key(), secret(), { identity, name: 'Reader', ttl })
      at.addGrant({ roomJoin: true, room, canPublishData: true, canSubscribe: true })
      at.roomConfig = new RoomConfiguration({
        agents: [new RoomAgentDispatch({ agentName: 'copilot', metadata })],
      })
      return { url: url(), token: await at.toJwt(), room }
    },
    /* the room recorded as one film into the bucket under the booking; the mock lands a fixture and posts itself the event */
    async record(b) {
      const path = `${b.uid}/recording.mp4`
      if (mock()) {
        const base = (env('SUPABASE_URL') || '').replace(/\/$/, ''), k = env('SUPABASE_SERVICE_ROLE_KEY') || ''
        const bytes = new Uint8Array(96 * 1024).fill(7)
        const up = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${k}`, apikey: k, 'Content-Type': 'video/mp4', 'x-upsert': 'true' }, body: bytes })
        if (!up.ok) throw new Error(`the bucket refused (${up.status}): ${(await up.text().catch(() => '')).slice(0, 200)}`)
        /* the mock's film has landed the moment it is asked for: the row says so as the egress_ended event would */
        const now = new Date().toISOString()
        await db.from('bookings').update({ recording_path: path, recording_at: now, recording_state: null, recording_error: null, updated_at: now }).eq('uid', b.uid)
        return { started: true, egress: 'mock', path }
      }
      const s = s3()
      const out = new EncodedFileOutput({ fileType: EncodedFileType.MP4, filepath: path, output: { case: 's3', value: new S3Upload({ endpoint: s.endpoint, accessKey: s.accessKey, secret: s.secret, region: s.region, bucket: s.bucket, forcePathStyle: true }) } })
      const client = new EgressClient(http(), key(), secret())
      const info = await client.startRoomCompositeEgress(ref(b), out, { layout: 'speaker' })
      await db.from('bookings').update({ recording_state: 'pending', recording_error: 'recording', updated_at: new Date().toISOString() }).eq('uid', b.uid)
      return { started: true, egress: info.egressId, path }
    },
    /* the room ended for everyone — on the dev server too, so a local call ends as a real one does */
    async end(b) {
      try { await new RoomServiceClient(http(), key(), secret()).deleteRoom(ref(b)) } catch (e) { /* already gone, or no server */ }
    },
    /* the room's notification, its signature checked by the SDK (the Authorization header a JWT over the body's sha256) */
    async event(req) {
      /* the mock's secret is public (it is in this file): with no account it verifies nothing, unless the
         mock was asked for by name, which the deploy refuses */
      if (!configured() && env('LIVEKIT_MOCK') !== '1') return { refused: 'livekit is not configured' }
      const raw = await req.text()
      const receiver = new WebhookReceiver(key(), secret())
      let ev
      try { ev = await receiver.receive(raw, req.headers.get('Authorization') || '') } catch (e) { return { refused: 'bad signature' } }
      const roomName = ev.room?.name || ev.egressInfo?.roomName || null
      if (ev.event === 'room_started' || ev.event === 'participant_joined') return { kind: 'started', ref: roomName }
      if (ev.event === 'room_finished') return { kind: 'ended', ref: roomName }
      if (ev.event === 'egress_ended') {
        const f = (ev.egressInfo?.fileResults || [])[0]
        const st = ev.egressInfo?.status
        const failed = st === EgressStatus.EGRESS_FAILED || st === EgressStatus.EGRESS_ABORTED || st === 'EGRESS_FAILED' || st === 'EGRESS_ABORTED'
        return { kind: 'recording', ref: roomName, path: f?.filename || null, failure: failed ? (ev.egressInfo?.error || 'the recording failed') : null }
      }
      return { kind: 'other', ref: roomName }
    },
  }
}
