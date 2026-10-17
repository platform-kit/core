#!/usr/bin/env node
/*
 * A small Stripe-shaped fake processor for local end-to-end tests of the Hyperswitch adapter.
 * Point a Hyperswitch Router's Stripe connector base URL at it (`stripe.base_url`). It accepts card
 * numbers, which Stripe itself refuses until raw card data APIs are enabled, so it exercises the
 * Router, SDK, vault, adapter, retrieval, and refund paths without a real processor. It verifies
 * nothing about Stripe: it is a test double, never a stand-in for a Stripe test result.
 *
 * Card 4000000000000002 is declined; any other card number succeeds.
 *   node packages/kit/build/hyperswitch-fake-processor.mjs [port]
 */
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const id = (prefix) => `${prefix}_${randomBytes(12).toString('hex')}`
const now = () => Math.floor(Date.now() / 1000)

function parseForm(text) {
  const out = {}
  for (const [key, value] of new URLSearchParams(text)) out[key] = value
  return out
}

function charge(intent) {
  return {
    id: intent.latest_charge,
    object: 'charge',
    amount: intent.amount,
    currency: intent.currency,
    status: 'succeeded',
    paid: true,
    payment_intent: intent.id,
    amount_refunded: intent.refunded,
    refunded: intent.refunded >= intent.amount,
    payment_method_details: { type: 'card', card: { brand: 'visa', last4: intent.last4 } },
  }
}

function intentBody(intent) {
  return {
    id: intent.id,
    object: 'payment_intent',
    amount: intent.amount,
    amount_capturable: 0,
    amount_received: intent.status === 'succeeded' ? intent.amount : 0,
    currency: intent.currency,
    status: intent.status,
    client_secret: `${intent.id}_secret_fake`,
    created: intent.created,
    customer: intent.customer ?? null,
    payment_method: intent.payment_method,
    metadata: intent.metadata,
    latest_charge: intent.status === 'succeeded' ? charge(intent) : null,
  }
}

function error(res, status, code, message, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { type: 'card_error', code, message, ...extra } }))
}

function send(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function startFakeProcessor(port = 12111) {
  const intents = new Map()
  const refunds = new Map()
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const url = new URL(req.url, 'http://fake')
      const form = parseForm(Buffer.concat(chunks).toString('utf8'))
      const path = url.pathname

      if (req.method === 'POST' && path === '/v1/customers') {
        return send(res, { id: id('cus'), object: 'customer', email: form.email ?? null })
      }
      if (req.method === 'POST' && path === '/v1/payment_intents') {
        const number = String(form['payment_method_data[card][number]'] ?? '').replace(/\s/g, '')
        const metadata = {}
        for (const [key, value] of Object.entries(form)) {
          const match = key.match(/^metadata\[(.+)\]$/)
          if (match) metadata[match[1]] = value
        }
        if (number === '4000000000000002') {
          return error(res, 402, 'card_declined', 'Your card was declined.', { decline_code: 'generic_decline' })
        }
        const intent = {
          id: id('pi'),
          amount: Number(form.amount),
          currency: String(form.currency || 'usd').toLowerCase(),
          status: 'succeeded',
          created: now(),
          customer: form.customer,
          payment_method: id('pm'),
          latest_charge: id('ch'),
          last4: number.slice(-4) || '4242',
          refunded: 0,
          metadata,
        }
        intents.set(intent.id, intent)
        return send(res, intentBody(intent))
      }
      const intentMatch = path.match(/^\/v1\/payment_intents\/([^/]+)$/)
      if (req.method === 'GET' && intentMatch) {
        const intent = intents.get(intentMatch[1])
        return intent ? send(res, intentBody(intent)) : error(res, 404, 'resource_missing', 'No such payment_intent')
      }
      if (req.method === 'POST' && path === '/v1/refunds') {
        const intent = intents.get(form.payment_intent)
        if (!intent) return error(res, 404, 'resource_missing', 'No such payment_intent')
        const amount = form.amount ? Number(form.amount) : intent.amount - intent.refunded
        if (amount > intent.amount - intent.refunded) {
          return error(res, 400, 'charge_already_refunded', 'Charge has already been refunded.')
        }
        intent.refunded += amount
        const refund = {
          id: id('re'), object: 'refund', amount, currency: intent.currency,
          payment_intent: intent.id, status: 'succeeded', metadata: {},
        }
        refunds.set(refund.id, refund)
        return send(res, refund)
      }
      const refundMatch = path.match(/^\/v1\/refunds\/([^/]+)$/)
      if (req.method === 'GET' && refundMatch) {
        const refund = refunds.get(refundMatch[1])
        return refund ? send(res, refund) : error(res, 404, 'resource_missing', 'No such refund')
      }
      if (path === '/health') return send(res, { ok: true })
      return error(res, 404, 'resource_missing', `Unrecognized request URL: ${req.method} ${path}`)
    })
  })

  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => resolve({
      port: server.address().port,
      stop: () => new Promise((done) => { server.close(() => done()); server.closeAllConnections?.() }),
    }))
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startFakeProcessor(Number(process.argv[2] || 12111))
  console.log(`fake processor listening on ${port}`)
}
