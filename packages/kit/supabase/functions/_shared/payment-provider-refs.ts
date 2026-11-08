import { admin } from './lib.ts'

const PROVIDER_ID = /^[a-z][a-z0-9-]*$/

export async function findProviderEntities(
  provider: string,
  objectType: string,
  externalId: string,
  entityType: string,
): Promise<string[]> {
  if (!PROVIDER_ID.test(provider)) throw new TypeError('payment reference provider id is invalid')
  if (!objectType || !externalId || !entityType) throw new TypeError('payment reference lookup requires object, external, and entity ids')
  const { data, error } = await admin.from('payment_provider_refs')
    .select('entity_id')
    .eq('provider', provider)
    .eq('object_type', objectType)
    .eq('external_id', externalId)
    .eq('entity_type', entityType)
  if (error) throw new Error(`payment provider reference lookup failed: ${error.message}`)
  return (data ?? []).map((row) => row.entity_id)
}

export async function findProviderEntity(
  provider: string,
  objectType: string,
  externalId: string,
  entityType: string,
): Promise<string | null> {
  const entities = await findProviderEntities(provider, objectType, externalId, entityType)
  if (entities.length > 1) {
    throw new Error(`payment provider reference is ambiguous: ${provider}/${objectType}/${externalId}`)
  }
  return entities[0] ?? null
}

export async function findProviderExternalIds(
  provider: string,
  objectType: string,
  entityType: string,
  entityId: string,
): Promise<string[]> {
  if (!PROVIDER_ID.test(provider)) throw new TypeError('payment reference provider id is invalid')
  if (!objectType || !entityType || !entityId) throw new TypeError('payment reference lookup requires object and entity ids')
  const { data, error } = await admin.from('payment_provider_refs')
    .select('external_id')
    .eq('provider', provider)
    .eq('object_type', objectType)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
  if (error) throw new Error(`payment provider reference lookup failed: ${error.message}`)
  return (data ?? []).map((row) => row.external_id)
}

export async function linkProviderEntity(
  provider: string,
  objectType: string,
  externalId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  if (!PROVIDER_ID.test(provider)) throw new TypeError('payment reference provider id is invalid')
  if (!objectType || !externalId || !entityType || !entityId) {
    throw new TypeError('payment reference requires object, external, entity type, and entity ids')
  }
  const { error } = await admin.from('payment_provider_refs').upsert({
    provider, object_type: objectType, external_id: externalId, entity_type: entityType, entity_id: entityId,
  }, { onConflict: 'provider,object_type,external_id,entity_type,entity_id', ignoreDuplicates: true })
  if (error) throw new Error(`payment provider reference was not recorded: ${error.message}`)
}
