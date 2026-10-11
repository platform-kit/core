/*
 * VAPID keys for web push, once per deployment: node build/vapid.mjs prints a public key (the
 * client's, VITE_VAPID_PUBLIC_KEY) and a private key (the push function's, VAPID_PRIVATE_KEY) —
 * P-256, base64url, as the push services want them. The private key is a secret: the deploy
 * environment and the local .env, never the repository.
 */
import { generateKeyPairSync } from 'node:crypto'
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const b64 = (b) => Buffer.from(b).toString('base64url')
const pub = publicKey.export({ format: 'jwk' }), prv = privateKey.export({ format: 'jwk' })
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')])
console.log('VITE_VAPID_PUBLIC_KEY=' + b64(raw))
console.log('VAPID_PRIVATE_KEY=' + prv.d)
console.log('VAPID_SUBJECT=mailto:support@example.com')
