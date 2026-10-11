import { createSocialAdapterRegistry } from './adapter.mjs'
import { xAdapter } from './x-sdk.ts'
import { DIRECT_SOCIAL_ADAPTERS } from './direct-sdk.mjs'

export const SOCIAL_ADAPTERS = createSocialAdapterRegistry([xAdapter, ...DIRECT_SOCIAL_ADAPTERS])
