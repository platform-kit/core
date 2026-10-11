import { connectedAccountRef, createSocial } from 'npm:@opencoredev/social-sdk@0.5.0'
import { postForMe } from 'npm:@opencoredev/social-sdk@0.5.0/cloud/post-for-me'
import { postfast } from 'npm:@opencoredev/social-sdk@0.5.0/cloud/postfast'
import { MemoryManagedMediaStore, zernio } from 'npm:@opencoredev/social-sdk@0.5.0/cloud/zernio'

const FACTORIES = Object.freeze({
  zernio,
  'post-for-me': postForMe,
  postfast,
})

export const MANAGED_BACKEND_IDS = Object.freeze(Object.keys(FACTORIES))

export function managedPublishPlatforms(client) {
  const platforms = new Set()
  const manifests = Object.values(client.capabilities())
  for (const value of manifests) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.capabilities)) continue
    for (const capability of value.capabilities) {
      if (
        capability &&
        typeof capability === 'object' &&
        typeof capability.platform === 'string' &&
        capability.platform !== '*' &&
        capability.operation === 'posts.publish' &&
        capability.availability === 'available'
      )
        platforms.add(capability.platform)
    }
  }
  return [...platforms].sort()
}

export const MANAGED_NATIVE_OPERATIONS = Object.freeze({
  zernio: Object.freeze(['createConnection', 'listProfiles']),
  'post-for-me': Object.freeze(['createConnection']),
  postfast: Object.freeze(['createConnectLink']),
})

/** @param {string} id @returns {id is 'zernio' | 'post-for-me' | 'postfast'} */
export function hasManagedBackend(id) {
  return Object.hasOwn(FACTORIES, id)
}

export function createManagedSocial(id, apiKey, options = {}) {
  const factory = FACTORIES[id]
  if (!factory) throw new Error(`No managed social backend is registered for "${id}".`)
  if (typeof apiKey !== 'string' || !apiKey.trim())
    throw new TypeError(`Managed social backend "${id}" needs an API key.`)

  const adapter = factory({
    apiKey,
    mediaStore: options.mediaStore || new MemoryManagedMediaStore(),
    ...(options.webhookSecret ? { webhookSecret: options.webhookSecret } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })
  return createSocial({ backends: { [id]: adapter } })
}

export function managedOperationContext(backendId, correlationId = crypto.randomUUID()) {
  return {
    backendInstance: backendId,
    correlationId,
    retryBudget: { maxAttempts: 1, maxElapsedMs: 60_000 },
  }
}

export { connectedAccountRef }

export async function invokeManagedNative(client, backendId, operation, input = {}) {
  const allowed = MANAGED_NATIVE_OPERATIONS[backendId] || []
  if (!allowed.includes(operation))
    throw Object.assign(new Error('This native operation is not declared by the managed backend.'), {
      code: 'operation_unsupported',
    })
  const native = client.native(backendId, { acknowledgeUnsafe: true })
  const method = native?.[operation]
  if (typeof method !== 'function')
    throw Object.assign(new Error('This native operation is not available.'), {
      code: 'operation_unsupported',
    })
  return method(input, managedOperationContext(backendId))
}
