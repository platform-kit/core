export function isPublishedMeteredUsageOffer(offer) {
  return offer?.published !== false
    && offer?.billing === 'subscription'
    && typeof offer.usage?.meter === 'string'
    && offer.usage.meter.trim().length > 0
}

export function hasPublishedMeteredUsagePlan(offers) {
  return Array.isArray(offers) && offers.some(isPublishedMeteredUsageOffer)
}
