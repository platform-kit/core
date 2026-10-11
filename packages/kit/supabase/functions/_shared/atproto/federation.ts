/*
 * THE WIDER NETWORK — a joined member's portable identity and their public repository, and the
 * stream that tells relays what changed (openspec: social-network, atproto-api; 93-network.sql).
 *
 * JOINING IS THE MEMBER'S OWN ACT, and only possible where the site federates. It makes a did:plc for
 * them at the PLC directory: a genesis operation naming their handle, this site as the server that
 * holds their posts, and their signing key, signed by the site's rotation key
 * (NETWORK_PLC_ROTATION_KEY) — which is why the identity can later be moved, and why that key is a
 * secret only the deploy holds. Their signing key is made here and kept in Vault.
 *
 * THE REPOSITORY IS A PROJECTION. What a joined member has made public — their everyone posts, their
 * likes and reposts of public posts, whom they follow, whom of the joined they block, their profile —
 * is worked out from the rows, compared with what the repository holds, and the difference committed
 * and signed with @atproto/repo. A `here` post is never in it: a signed repository is one tree that
 * relays copy whole. Made again from nothing it holds the same records, so it is derived; the event
 * sequence relays have read is state.
 *
 * LEAVING deactivates the account on the stream and takes the repository down; joining again is the
 * same identity. A suspension is a takedown on the stream, its lift the account active again.
 */
import { admin, appUrl } from '../lib.ts'
import { Secp256k1Keypair } from 'npm:@atproto/crypto@0.5.7'
import { Repo, MemoryBlockstore, BlockMap, WriteOpAction, blocksToCarFile } from 'npm:@atproto/repo@0.11.0'
import { jsonToLex, lexToJson } from 'npm:@atproto/lex-json@0.1.7'
import { encode as cborEncode } from 'npm:@atproto/lex-cbor@0.1.7'
import { parseCid } from 'npm:@atproto/lex-data@0.1.8'
import { POST, LIKE, REPOST, FOLLOW, BLOCK, PROFILE, uriOf, handleOf } from './ids.js'
import { newCtx, loadPeople, loadPosts, recordOf, cidOf, didFor } from './views.ts'

const PLC = () => (Deno.env.get('NETWORK_PLC_URL') || 'https://plc.directory').replace(/\/+$/, '')
const enc = new TextEncoder()

/* ---------------------------------------------------------------- identity */

const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
function base32(bytes: Uint8Array) {
  let bits = 0, value = 0, out = ''
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function rotationKey() {
  const hex = String(Deno.env.get('NETWORK_PLC_ROTATION_KEY') || '').trim()
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('NETWORK_PLC_ROTATION_KEY is not set: the site cannot make an identity on the wider network')
  return Secp256k1Keypair.import(hex)
}

/* THE GENESIS OPERATION of a member's did:plc, signed by the site's rotation key — the DID is the hash
   of the signed operation, so it is fixed by what it says */
export async function genesis(handle: string, signingDid: string, pds: string) {
  const rot = await rotationKey()
  const unsigned = {
    type: 'plc_operation',
    rotationKeys: [rot.did()],
    verificationMethods: { atproto: signingDid },
    alsoKnownAs: [`at://${handle}`],
    services: { atproto_pds: { type: 'AtprotoPersonalDataServer', endpoint: pds } },
    prev: null,
  }
  const sig = await rot.sign(cborEncode(jsonToLex(unsigned as any)))
  const op = { ...unsigned, sig: b64u(sig) }
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', cborEncode(jsonToLex(op as any))))
  return { did: 'did:plc:' + base32(hash).slice(0, 24), op }
}

/* ---------------------------------------------------------------- the stream */

async function emit(did: string, kind: 'commit' | 'identity' | 'account' | 'sync', body: Record<string, unknown>, blocks?: Uint8Array) {
  await admin.from('network_seq').insert({ did, kind, body, blocks: blocks ? '\\x' + [...blocks].map((b) => b.toString(16).padStart(2, '0')).join('') : null })
}
const now = () => new Date().toISOString()

/* ---------------------------------------------------------------- the repository */

async function keypairOf(identity: any) {
  const hex = (await admin.rpc('network_key_read', { p_secret_id: identity.signing_key_id })).data as string
  return Secp256k1Keypair.import(hex)
}

const fromHex = (h: string) => { const s = String(h).replace(/^\\x/, ''); const out = new Uint8Array(s.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16); return out }

async function loadRepo(did: string) {
  const { data: head } = await admin.from('network_commits').select('cid, rev').eq('did', did).maybeSingle()
  const storage = new MemoryBlockstore()
  if (!head) return { storage, repo: null as Repo | null }
  const { data: rows } = await admin.from('network_repo_blocks').select('cid, bytes').eq('did', did)
  for (const r of (rows || []) as any[]) await storage.putBlock(parseCid(r.cid), fromHex(r.bytes))
  const repo = await Repo.load(storage, parseCid(head.cid))
  return { storage, repo }
}

/* everything a joined member has made public, as records keyed by collection/rkey */
async function publicRecords(userId: string, domain: string) {
  const ctx = newCtx(admin, userId, domain, '')
  const out = new Map<string, any>()
  const { data: posts } = await admin.from('network_posts').select('id').eq('author_id', userId).eq('audience', 'everyone').is('removed_at', null)
  await loadPosts(ctx, ((posts || []) as any[]).map((p) => p.id))
  await loadPeople(ctx, [userId])
  for (const p of (posts || []) as any[]) {
    const row = ctx.posts.get(p.id)
    if (row) out.set(`${POST}/${row.rkey}`, await recordOf(ctx, row))
  }
  /* a like or a repost is public where what it names is: a joined member's everyone post, or a post elsewhere */
  for (const [table, coll] of [['network_likes', LIKE], ['network_reposts', REPOST]] as const) {
    const { data } = await admin.from(table).select('rkey, post_id, subject_uri, subject_cid, created_at').eq('author_id', userId)
    for (const r of (data || []) as any[]) {
      let subject: any = null
      if (r.subject_uri) subject = { uri: r.subject_uri, cid: r.subject_cid }
      else {
        const { data: p } = await admin.from('network_posts').select('*').eq('id', r.post_id).maybeSingle()
        if (p && p.audience === 'everyone' && !p.removed_at && (await admin.rpc('network_joined', { p_user: p.author_id })).data) {
          await loadPeople(ctx, [p.author_id]); ctx.posts.set(p.id, p)
          subject = { uri: uriOf(didFor(ctx, p.author_id), POST, p.rkey), cid: await cidOf(ctx, p.id, await recordOf(ctx, p)) }
        }
      }
      if (subject) out.set(`${coll}/${r.rkey}`, { $type: coll, subject, createdAt: new Date(r.created_at).toISOString() })
    }
  }
  /* whom they follow: a joined member by their portable DID, or somebody elsewhere */
  const { data: follows } = await admin.from('network_follows').select('rkey, subject_id, subject_did, created_at').eq('follower_id', userId)
  for (const f of (follows || []) as any[]) {
    let subject = f.subject_did
    if (!subject && f.subject_id) { const { data: i } = await admin.from('network_identities').select('did').eq('user_id', f.subject_id).not('joined_at', 'is', null).is('left_at', null).maybeSingle(); subject = i && i.did }
    if (subject) out.set(`${FOLLOW}/${f.rkey}`, { $type: FOLLOW, subject, createdAt: new Date(f.created_at).toISOString() })
  }
  const { data: blocks } = await admin.from('network_blocks').select('rkey, blocked_id, created_at').eq('blocker_id', userId)
  for (const b of (blocks || []) as any[]) {
    const { data: i } = await admin.from('network_identities').select('did').eq('user_id', b.blocked_id).not('joined_at', 'is', null).is('left_at', null).maybeSingle()
    if (i) out.set(`${BLOCK}/${b.rkey}`, { $type: BLOCK, subject: i.did, createdAt: new Date(b.created_at).toISOString() })
  }
  const { data: prof } = await admin.from('profiles').select('display_name, about').eq('id', userId).maybeSingle()
  if (prof && (prof.display_name || prof.about)) out.set(`${PROFILE}/self`, { $type: PROFILE, ...(prof.display_name ? { displayName: prof.display_name } : {}), ...(prof.about ? { description: prof.about } : {}) })
  return out
}

/*
 * MAKE ONE MEMBER'S REPOSITORY AGREE with what they have made public: the difference committed, signed,
 * stored, and told to relays as one commit event. A member who has left, or is suspended, has the
 * matching account event instead and no commit.
 */
export async function project(userId: string, domain: string) {
  const { data: identity } = await admin.from('network_identities').select('*').eq('user_id', userId).maybeSingle()
  if (!identity || !identity.joined_at || identity.left_at) return { skipped: true }
  const did = identity.did as string
  const suspended = !!(await admin.rpc('network_suspended', { p_user: userId })).data
  const { data: lastAccount } = await admin.from('network_seq').select('body').eq('did', did).eq('kind', 'account').order('seq', { ascending: false }).limit(1).maybeSingle()
  const wasActive = !lastAccount || lastAccount.body.active !== false
  if (suspended) {
    if (wasActive) await emit(did, 'account', { did, time: now(), active: false, status: 'takendown' })
    return { takendown: true }
  }
  if (!wasActive) await emit(did, 'account', { did, time: now(), active: true })

  const want = await publicRecords(userId, domain)
  const keypair = await keypairOf(identity)
  const { storage, repo } = await loadRepo(did)
  const have = new Map<string, string>()
  if (repo) for await (const r of repo.walkRecords()) have.set(`${r.collection}/${r.rkey}`, String(r.cid))

  const ops: any[] = []
  for (const [path, value] of want) {
    const [collection, rkey] = [path.slice(0, path.lastIndexOf('/')), path.slice(path.lastIndexOf('/') + 1)]
    const lexValue = jsonToLex(value)
    if (!have.has(path)) ops.push({ action: WriteOpAction.Create, collection, rkey, record: lexValue })
    else {
      const cid = await cidOf(newCtx(admin, null, domain, ''), path, value)
      if (cid !== have.get(path)) ops.push({ action: WriteOpAction.Update, collection, rkey, record: lexValue })
    }
  }
  for (const path of have.keys()) if (!want.has(path)) {
    const i = path.lastIndexOf('/')
    ops.push({ action: WriteOpAction.Delete, collection: path.slice(0, i), rkey: path.slice(i + 1) })
  }
  if (repo && !ops.length) return { unchanged: true }

  let commit: any
  if (!repo) {
    const created = await Repo.create(storage, did, keypair, ops.filter((o) => o.action === WriteOpAction.Create))
    const blocks = new BlockMap()
    for (const [cid, bytes] of storage.blocks) blocks.set(cid, bytes)
    commit = { cid: created.cid, rev: created.commit.rev, since: null, prev: null, newBlocks: blocks, removedCids: { toList: () => [] } }
  } else {
    commit = await repo.formatCommit(ops, keypair)
    await storage.applyCommit(commit)
  }
  /* what the commit added, and what it let go */
  const newRows: any[] = []
  for (const [cid, bytes] of commit.newBlocks) newRows.push({ did, cid: String(cid), bytes: '\\x' + [...(bytes as Uint8Array)].map((b) => b.toString(16).padStart(2, '0')).join('') })
  for (let i = 0; i < newRows.length; i += 200) await admin.from('network_repo_blocks').upsert(newRows.slice(i, i + 200), { onConflict: 'did,cid' })
  const removed = commit.removedCids.toList().map((c: any) => String(c))
  if (removed.length) await admin.from('network_repo_blocks').delete().eq('did', did).in('cid', removed)
  await admin.from('network_commits').upsert({ did, user_id: userId, cid: String(commit.cid), rev: commit.rev, updated_at: now() })

  /* WHAT A RELAY NEEDS TO CHECK IT: the new blocks and the ones its proofs pass through (the commit,
     the tree's path to every record touched), and the tree's root before — so the commit can be
     verified, and inverted, from the event alone (the sync protocol's own rule) */
  const carried = new BlockMap()
  for (const [cid, bytes] of commit.newBlocks) carried.set(cid, bytes)
  if (commit.relevantBlocks) for (const [cid, bytes] of commit.relevantBlocks) carried.set(cid, bytes)
  const car = await blocksToCarFile(commit.cid, carried)
  const prevData = repo ? String(repo.commit.data) : null
  const opsOut = []
  for (const o of ops) {
    const path = `${o.collection}/${o.rkey}`
    opsOut.push({ action: o.action, path, cid: o.action === WriteOpAction.Delete ? null : { $link: await cidOf(newCtx(admin, null, domain, ''), 'op' + path, want.get(path)) } })
  }
  await emit(did, 'commit', { repo: did, commit: { $link: String(commit.cid) }, rev: commit.rev, since: commit.since ?? null, ops: opsOut, blobs: [], rebase: false, tooBig: false, time: now(), ...(prevData ? { prevData: { $link: prevData } } : {}) }, car)
  return { committed: ops.length }
}

/* ---------------------------------------------------------------- joining and leaving */

export async function join(userId: string, domain: string) {
  const { data: p } = await admin.from('profiles').select('username, public_profile').eq('id', userId).maybeSingle()
  if (!p || !p.username) return { error: 'username' }
  const handle = handleOf(p.username, domain)!
  const { data: existing } = await admin.from('network_identities').select('*').eq('user_id', userId).maybeSingle()
  if (existing && existing.joined_at && !existing.left_at) return { did: existing.did }
  let did = existing && existing.did
  if (!existing) {
    const key = await Secp256k1Keypair.create({ exportable: true })
    const hex = [...(await key.export())].map((b) => b.toString(16).padStart(2, '0')).join('')
    const { data: secretId, error: kerr } = await admin.rpc('network_key_put', { p_secret: hex, p_name: 'network:' + userId + ':' + crypto.randomUUID().slice(0, 8) })
    if (kerr) return { error: kerr.message }
    const g = await genesis(handle, key.did(), appUrl())
    const res = await fetch(`${PLC()}/${encodeURIComponent(g.did)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(g.op) })
    if (!res.ok) return { error: `the PLC directory refused the identity (${res.status}): ${await res.text()}` }
    did = g.did
    const { error } = await admin.from('network_identities').insert({ user_id: userId, did, signing_key_id: secretId, signing_key_public: key.did(), joined_at: now() })
    if (error) return { error: error.message }
  } else {
    await admin.from('network_identities').update({ joined_at: now(), left_at: null }).eq('user_id', userId)
  }
  /* a page joined to the wider network is an open page: its everyone posts are public there anyway */
  if (!p.public_profile) await admin.from('profiles').update({ public_profile: true }).eq('id', userId)
  await emit(did, 'identity', { did, time: now(), handle })
  await emit(did, 'account', { did, time: now(), active: true })
  await project(userId, domain)
  return { did, handle }
}

export async function leave(userId: string) {
  const { data: i } = await admin.from('network_identities').select('*').eq('user_id', userId).maybeSingle()
  if (!i || !i.joined_at || i.left_at) return { left: true }
  await admin.from('network_identities').update({ left_at: now() }).eq('user_id', userId)
  await emit(i.did, 'account', { did: i.did, time: now(), active: false, status: 'deactivated' })
  await admin.from('network_repo_blocks').delete().eq('did', i.did)
  await admin.from('network_commits').delete().eq('did', i.did)
  await admin.from('network_dirty').delete().eq('user_id', userId)
  return { left: true }
}

/* ---------------------------------------------------------------- reading a repository */

export async function repoStatus(did: string) {
  const { data: i } = await admin.from('network_identities').select('user_id, joined_at, left_at').eq('did', did).maybeSingle()
  if (!i) return null
  const suspended = !!(await admin.rpc('network_suspended', { p_user: i.user_id })).data
  const { data: head } = await admin.from('network_commits').select('cid, rev').eq('did', did).maybeSingle()
  const active = !!i.joined_at && !i.left_at && !suspended
  return { did, active, ...(active ? {} : { status: suspended ? 'takendown' : 'deactivated' }), ...(head ? { rev: head.rev, commit: head.cid } : {}) }
}

export async function repoCar(did: string) {
  const { storage, repo } = await loadRepo(did)
  if (!repo) return null
  return blocksToCarFile(repo.cid, storage.blocks)
}

export async function recordCar(did: string, collection: string, rkey: string) {
  const { storage, repo } = await loadRepo(did)
  if (!repo) return null
  /* a record the repository does not hold is not found — never a proof of its absence dressed as one */
  if (!(await repo.getRecord(collection, rkey))) return null
  const { getRecords } = await import('npm:@atproto/repo@0.11.0')
  const chunks: Uint8Array[] = []
  for await (const c of getRecords(storage, repo.cid, [{ collection, rkey }])) chunks.push(c)
  const len = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(len); let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

/* ---------------------------------------------------------------- the stream's frames */

/* an event as it goes down the socket: a CBOR header, then the CBOR body — the blocks restored as bytes */
export function frameOf(row: any) {
  const t = '#' + row.kind
  const body: any = { ...row.body, seq: Number(row.seq) }
  const lex: any = jsonToLex(body)
  if (row.kind === 'commit') lex.blocks = row.blocks ? fromHex(row.blocks) : new Uint8Array()
  const head = cborEncode({ op: 1, t } as any)
  const tail = cborEncode(lex)
  const out = new Uint8Array(head.length + tail.length)
  out.set(head, 0); out.set(tail, head.length)
  return out
}
export const errorFrame = (error: string, message: string) => {
  const head = cborEncode({ op: -1 } as any), tail = cborEncode({ error, message } as any)
  const out = new Uint8Array(head.length + tail.length); out.set(head, 0); out.set(tail, head.length); return out
}

export { lexToJson }
