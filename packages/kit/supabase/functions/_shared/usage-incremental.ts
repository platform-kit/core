import { admin } from './lib.ts'
import { fresh } from './compiled.ts'
import { offerByKey } from './offers.ts'
import { findProviderExternalIds, linkProviderEntity } from './payment-provider-refs.ts'
import { meteredUsageAmountMinor } from './hyperswitch-billing.mjs'
import { createIncrementalUsageSettler } from './usage-incremental.mjs'
import type { PaymentProviderAdapter } from './payment-provider.d.ts'

const settle = createIncrementalUsageSettler({
  admin,
  offerByKey,
  toMinorUnits: meteredUsageAmountMinor,
  findProviderExternalIds,
  linkProviderEntity,
})

type IncrementalUsageInput = {
  subscriptionId: string
  periodStart: string
  periodEnd?: string | null
  finalize?: boolean
}

export async function settleIncrementalUsage(
  provider: PaymentProviderAdapter,
  input: IncrementalUsageInput,
) {
  await fresh()
  return settle(provider, input)
}
