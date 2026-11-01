export function isPublishedMeteredUsageOffer(offer: any) {
  return offer?.published !== false
    && offer?.billing === 'subscription'
    && typeof offer.usage?.meter === 'string'
    && offer.usage.meter.trim().length > 0
}

export function hasPublishedMeteredUsagePlan(offers: any) {
  return Array.isArray(offers) && offers.some(isPublishedMeteredUsageOffer)
}
