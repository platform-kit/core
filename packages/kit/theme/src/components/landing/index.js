/*
 * The sections a landing page can be assembled from. A page's markdown names
 * them by key, with props; anything not in this list is skipped with a warning
 * in dev, so a typo in a page never takes the page down.
 */
import { moduleOn } from 'platformkit/lib/modules.js'
import LandingHero from './LandingHero.vue'
import LandingMarquee from './LandingMarquee.vue'
import LandingHow from './LandingHow.vue'
import LandingClose from './LandingClose.vue'
import LandingLibrary from './LandingLibrary.vue'
import LandingCoaching from './LandingCoaching.vue'
import LandingCreator from './LandingCreator.vue'
import LandingPricing from './LandingPricing.vue'
import LandingForm from './LandingForm.vue'
import LandingLogos from './LandingLogos.vue'
import LandingFeatures from './LandingFeatures.vue'
import LandingSplit from './LandingSplit.vue'
import LandingStats from './LandingStats.vue'
import LandingTestimonials from './LandingTestimonials.vue'
import LandingFAQ from './LandingFAQ.vue'
import LandingTeam from './LandingTeam.vue'
import LandingCompare from './LandingCompare.vue'
import LandingGallery from './LandingGallery.vue'
import LandingVideo from './LandingVideo.vue'
import LandingProse from './LandingProse.vue'
import LandingTimeline from './LandingTimeline.vue'
import LandingBento from './LandingBento.vue'
import LandingQuote from './LandingQuote.vue'
import LandingContact from './LandingContact.vue'
import LandingCta from './LandingCta.vue'
import LandingSteps from './LandingSteps.vue'
import LandingNewsletter from './LandingNewsletter.vue'
import LandingIntegrations from './LandingIntegrations.vue'
import LandingPerks from './LandingPerks.vue'
import LandingDivider from './LandingDivider.vue'
import LandingAnnouncement from './LandingAnnouncement.vue'
import LandingCountdown from './LandingCountdown.vue'
import LandingBeforeAfter from './LandingBeforeAfter.vue'
import LandingShowcase from './LandingShowcase.vue'
import LandingCarousel from './LandingCarousel.vue'
import LandingTabs from './LandingTabs.vue'
import LandingFooter from './LandingFooter.vue'
import { defineAsyncComponent } from 'vue'
import { modules } from '#site'
import { SECTIONS as SITE_SECTIONS } from '#site/landing'   /* the site's own section types (platformkit.config.js landing.sections) */

export const SECTIONS = {
  Hero: LandingHero,
  Marquee: LandingMarquee,
  How: LandingHow,
  Close: LandingClose,
  Library: LandingLibrary,
  Coaching: LandingCoaching,
  Creator: LandingCreator,
  Pricing: LandingPricing,
  Logos: LandingLogos,
  Features: LandingFeatures,
  Split: LandingSplit,
  Stats: LandingStats,
  Testimonials: LandingTestimonials,
  FAQ: LandingFAQ,
  Team: LandingTeam,
  Compare: LandingCompare,
  Gallery: LandingGallery,
  Video: LandingVideo,
  Prose: LandingProse,
  Timeline: LandingTimeline,
  Bento: LandingBento,
  Quote: LandingQuote,
  Contact: LandingContact,
  Cta: LandingCta,
  Steps: LandingSteps,
  Newsletter: LandingNewsletter,
  Integrations: LandingIntegrations,
  Perks: LandingPerks,
  Divider: LandingDivider,
  Announcement: LandingAnnouncement,
  Countdown: LandingCountdown,
  BeforeAfter: LandingBeforeAfter,
  Showcase: LandingShowcase,
  Carousel: LandingCarousel,
  Tabs: LandingTabs,
  Footer: LandingFooter,
  ...(moduleOn('store') ? { Products: defineAsyncComponent(() => import('./LandingProducts.vue')), Spotlight: defineAsyncComponent(() => import('./LandingSpotlight.vue')), Collections: defineAsyncComponent(() => import('./LandingCollections.vue')) } : {}),   /* the store's own, with the module on: the products, one in the spotlight, the collections — their own chunks */
  ...(moduleOn('articles') ? { Articles: defineAsyncComponent(() => import('./LandingArticles.vue')) } : {}),   /* the latest articles: the articles module's section, its own chunk */
  ...(moduleOn('forms') ? { Form: LandingForm } : {}),   /* a form inline: the forms module's door */
  ...(moduleOn('models') ? { Entries: defineAsyncComponent(() => import('./LandingEntries.vue')) } : {}),   /* a content model's entries: the models module's section, its own chunk */
  ...SITE_SECTIONS,
}
export const SECTION_NAMES = Object.keys(SECTIONS)

/*
 * The looks (src/lib/look.js): each names the skins it wears — the sections built
 * differently from their base markup (skins/index.js). Both looks wear the same
 * design; a look is a palette. A section a look does not name renders the base.
 * The markdown is the same for every look.
 */
import { SKINS_BY_LOOK } from '#site/landing'   /* each look's skins, from platformkit.config.js */

export const LOOKS = SKINS_BY_LOOK

/* the component for a section under a look */
export function resolve(name, look) {
  const skins = LOOKS[look]
  return (skins && skins[name]) || SECTIONS[name] || null
}
