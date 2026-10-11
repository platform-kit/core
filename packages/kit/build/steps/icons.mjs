/* The icons the pages name: .velite/icons.json with every Lucide icon a page's `icon` field names (build/icons.mjs); every icon in dev */
export default {
  key: 'icons', title: 'The icons the pages name', phase: 'prepare',
  inputs: ['content/pages/**'],
  run: async ({ dev }) => { const { buildIcons } = await import('../icons.mjs'); buildIcons({ all: !!dev || process.env.PLATFORMKIT_ICONS_ALL === '1' }) },
}
