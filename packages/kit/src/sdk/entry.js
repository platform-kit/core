/* the drop-in's entry: install window.posthog and nothing else (sdk/posthog.js is the object) */
import { install } from './posthog.js'
install(window)
