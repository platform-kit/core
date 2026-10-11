/*
 * One AG Grid theme that follows the site's light/dark setting, so a grid on a
 * dark page reads dark instead of a stark white panel. Quartz on light; Quartz
 * with the dark-blue colour scheme on dark, to sit with the navy dark theme.
 *
 * Returns a computed theme; use it as `:theme="theme"`. Tracks both an explicit
 * data-theme choice and the OS preference, and cleans its listeners up.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { themeQuartz, colorSchemeDarkBlue } from 'ag-grid-community'

export function useAgGridTheme(params = { fontSize: 13.5, fontFamily: 'inherit' }) {
  const light = themeQuartz.withParams(params)
  const dark = themeQuartz.withPart(colorSchemeDarkBlue).withParams(params)

  const isDark = ref(false)
  const read = () => {
    const t = document.documentElement.dataset.theme
    isDark.value = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)
  }
  const mq = matchMedia('(prefers-color-scheme: dark)')
  let obs = null
  onMounted(() => {
    read()
    obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    mq.addEventListener('change', read)
  })
  onBeforeUnmount(() => {
    if (obs) obs.disconnect()
    mq.removeEventListener('change', read)
  })

  return computed(() => (isDark.value ? dark : light))
}
