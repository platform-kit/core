import { createSocialAdapterRegistry } from './adapter.mts'
import { xAdapter } from './x-sdk.ts'
import { DIRECT_SOCIAL_ADAPTERS } from './direct-sdk.mts'

export const SOCIAL_ADAPTERS = createSocialAdapterRegistry([xAdapter, ...DIRECT_SOCIAL_ADAPTERS])
