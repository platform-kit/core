/* The sales report: what sold in the last ninety days, for the store's best seller (build/sales.mjs) */
export default {
  key: 'sales', title: 'The sales report', phase: 'prepare', module: 'store',
  inputs: ['content/books/**', 'content/store/**'],
  run: async () => { const { salesReport } = await import('../sales.mjs'); await salesReport() },
}
