#!/usr/bin/env node
/*
 * A ROTATION KEY for a site that federates (network.federate in platformkit.config.js): the secp256k1
 * key that signs the portable identity (did:plc) made for each member who joins the wider network,
 * and the one key that can later move those identities. Printed once, to be set as
 * NETWORK_PLC_ROTATION_KEY wherever the site's secrets live — and never rotated away: a member's
 * identity names it, and losing it is losing the power to change their identity at all.
 *
 *   node ../../packages/kit/build/network-keys.mjs
 */
import { Secp256k1Keypair } from '@atproto/crypto'

const key = await Secp256k1Keypair.create({ exportable: true })
const hex = Buffer.from(await key.export()).toString('hex')
console.log('NETWORK_PLC_ROTATION_KEY=' + hex)
console.log('# its public half, which every member\'s identity names as its rotation key: ' + key.did())
