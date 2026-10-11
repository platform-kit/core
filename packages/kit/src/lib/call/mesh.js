/*
 * A call made browser to browser: one RTCPeerConnection per other person, all of them signalled over
 * the channel's own realtime topic — which is already private and already authorised by membership,
 * so the call needs no server of its own and lets nobody in who could not read the channel anyway.
 *
 * Who offers is decided by a rule both sides apply to the same two names (rules.js, shouldOffer), so
 * there is no arbitration and no glare. Everything else is plain WebRTC: a local stream, a track per
 * peer, ICE candidates passed along as they are found.
 *
 * What it does not do, it says: nothing here records, and the room carries the number the credentials
 * name (five). A pair that cannot reach each other directly needs a relay; with none, the call says
 * so rather than spinning, which is what `reachable` is for.
 */
import { reactive, ref } from 'vue'
import { supabase } from '../supabase.js'
import { shouldOffer, livePeers, roomFull, stateOf, reachable } from './rules.js'

const HELLO_MS = 5000      /* how often a peer says it is still here */

export function meshCall({ token, topic, iceServers, relay, max, me }) {
  const peers = reactive([])            /* [{ id, name, stream, speaking, muted, cameraOff, state }] */
  const state = ref('joining')          /* joining | live | full | failed | left */
  const trouble = ref(null)             /* what to say when a connection cannot be made */
  const local = reactive({ stream: null, muted: false, cameraOff: false })

  const pcs = new Map()                 /* peer id → RTCPeerConnection */
  const seen = []                       /* the hellos we have heard */
  let channel = null, timer = null, watch = null

  const peerRow = (id, name) => {
    let row = peers.find((p) => p.id === id)
    /* the clock runs from when THIS person appeared, not from when we joined: somebody sitting in
       a huddle for a minute must not be told the call cannot be made the moment another arrives */
    if (!row) { row = reactive({ id, name: name || '', stream: null, speaking: false, muted: false, cameraOff: false, state: 'connecting', since: Date.now() }); peers.push(row) }
    else if (name) row.name = name
    return row
  }
  const drop = (id) => {
    const pc = pcs.get(id)
    if (pc) { try { pc.close() } catch (e) { /* already gone */ } pcs.delete(id) }
    const i = peers.findIndex((p) => p.id === id)
    if (i >= 0) peers.splice(i, 1)
  }

  const say = (event, payload) => { if (channel) channel.send({ type: 'broadcast', event, payload: { from: me.id, ...payload } }).catch(() => {}) }

  function connect(id, name) {
    if (pcs.has(id)) return pcs.get(id)
    const pc = new RTCPeerConnection({ iceServers })
    pcs.set(id, pc)
    const row = peerRow(id, name)
    if (local.stream) for (const t of local.stream.getTracks()) pc.addTrack(t, local.stream)
    pc.onicecandidate = (e) => { if (e.candidate) say('ice', { to: id, candidate: e.candidate.toJSON() }) }
    pc.ontrack = (e) => { row.stream = e.streams[0] || new MediaStream([e.track]) }
    pc.onconnectionstatechange = () => {
      row.state = stateOf(pc.connectionState)
      if (row.state === 'gone') drop(id)
      if (row.state === 'failed') trouble.value = relay ? 'failed' : 'no-relay'
      /* one connection made is enough to know the call can be made */
      if (row.state === 'connected') trouble.value = null
    }
    return pc
  }

  async function offerTo(id, name) {
    const pc = connect(id, name)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    say('offer', { to: id, sdp: pc.localDescription, name: me.name })
  }

  async function heard(event, p) {
    if (!p || p.from === me.id || (p.to && p.to !== me.id)) return
    if (event === 'hello') {
      seen.push({ id: p.from, name: p.name, at: new Date().toISOString() })
      const live = livePeers(seen, me.id)
      if (roomFull(live.length + 1, max)) { state.value = 'full'; return }
      if (shouldOffer(me.id, p.from)) await offerTo(p.from, p.name)
      else peerRow(p.from, p.name)
      return
    }
    if (event === 'offer') {
      const pc = connect(p.from, p.name)
      await pc.setRemoteDescription(p.sdp)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      say('answer', { to: p.from, sdp: pc.localDescription, name: me.name })
      return
    }
    if (event === 'answer') {
      const pc = pcs.get(p.from)
      if (pc && !pc.currentRemoteDescription) await pc.setRemoteDescription(p.sdp)
      return
    }
    if (event === 'ice') {
      const pc = pcs.get(p.from)
      if (pc) { try { await pc.addIceCandidate(p.candidate) } catch (e) { /* a candidate for a connection already gone */ } }
      return
    }
    if (event === 'bye') drop(p.from)
  }

  async function join({ video = true, audio = true } = {}) {
    try {
      local.stream = await navigator.mediaDevices.getUserMedia({ video, audio })
    } catch (e) {
      state.value = 'failed'
      trouble.value = 'no-devices'
      return
    }
    channel = supabase.channel(topic, { config: { private: true, broadcast: { self: false } } })
    for (const e of ['hello', 'offer', 'answer', 'ice', 'bye']) channel.on('broadcast', { event: e }, ({ payload }) => heard(e, payload))
    await new Promise((res) => channel.subscribe((s) => { if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') res(s) }))
    state.value = 'live'
    say('hello', { name: me.name })
    timer = setInterval(() => say('hello', { name: me.name }), HELLO_MS)
    /* a peer we cannot reach is said so, rather than left waiting on a spinner — each judged from
       when they appeared, and never while any connection is up */
    watch = setInterval(() => {
      if (!peers.length || peers.some((p) => p.state === 'connected')) { if (trouble.value === 'no-relay') trouble.value = null; return }
      for (const p of peers) {
        const r = reachable({ relay, state: p.state, seconds: (Date.now() - (p.since || Date.now())) / 1000 })
        if (!r.ok) { trouble.value = r.reason; return }
      }
    }, 2000)
  }

  function setMic(on) {
    local.muted = !on
    if (local.stream) for (const t of local.stream.getAudioTracks()) t.enabled = !!on
    say('state', { muted: local.muted, cameraOff: local.cameraOff })
  }
  function setCam(on) {
    local.cameraOff = !on
    if (local.stream) for (const t of local.stream.getVideoTracks()) t.enabled = !!on
    say('state', { muted: local.muted, cameraOff: local.cameraOff })
  }

  async function leave() {
    state.value = 'left'
    say('bye', {})
    if (timer) clearInterval(timer)
    if (watch) clearInterval(watch)
    for (const [id] of pcs) drop(id)
    if (local.stream) for (const t of local.stream.getTracks()) t.stop()
    local.stream = null
    if (channel) { await supabase.removeChannel(channel); channel = null }
  }

  return { peers, state, trouble, local, join, leave, setMic, setCam, records: false, provider: 'mesh' }
}
