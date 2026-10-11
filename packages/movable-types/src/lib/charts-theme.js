/*
 * echarts, registered once with only what the dashboard draws, and an option
 * base that reads the site's tokens at render time so a chart matches whichever
 * theme the page is in.
 */
import { ref, watch } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components'

use([CanvasRenderer, LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent])

const cssVar = (name, fallback) => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback } catch (e) { return fallback }
}
export function tokens() {
  return {
    ink: cssVar('--ink', '#0c0d0b'), ink2: cssVar('--ink2', '#3a3c38'), ink3: cssVar('--ink3', '#6c6f69'),
    paper: cssVar('--paper', '#fbfaf3'), hair: cssVar('--hair', '#00000018'), accent: cssVar('--accent', '#0e8c8c'), accent2: cssVar('--accent2', '#0b6e6e'),
    mono: cssVar('--m', 'IBM Plex Mono, ui-monospace, Menlo, monospace'),
  }
}
/* how a series over time is drawn on every analytics page: bars by default, a line when the person prefers — one
   choice for all of them, remembered per browser (ChartKind.vue is the switch) */
const KIND_KEY = 'dl.analytics.chart'
export const chartKind = ref((() => { try { return localStorage.getItem(KIND_KEY) === 'line' ? 'line' : 'bar' } catch (e) { return 'bar' } })())
watch(chartKind, (v) => { try { localStorage.setItem(KIND_KEY, v) } catch (e) { /* private mode */ } })
/* a series over time in the chosen kind: bars (rounded, grouped) or a smooth line (an area under it when asked);
   a reference series — the window before — stays a thin dashed line whatever the kind, so it reads as a reference */
export function timeSeries({ name, data, color, area = false, reference = false, smooth = true, symbol = 'none' }) {
  if (reference) return { name, type: 'line', smooth, symbol: 'none', color, data, lineStyle: { width: 1.5, type: 'dashed', opacity: .6 }, z: 3 }
  if (chartKind.value === 'bar') return { name, type: 'bar', color, data, barMaxWidth: 22, barGap: '10%', itemStyle: { borderRadius: [3, 3, 0, 0] }, emphasis: { itemStyle: { opacity: .85 } } }
  return { name, type: 'line', smooth, symbol, symbolSize: 5, color, data, lineStyle: { width: 2 }, itemStyle: { color }, areaStyle: area ? { opacity: .10 } : undefined }
}
/* the x axis for a series over time: bars stand between the ticks, a line runs through them */
export const timeAxis = (axis) => ({ ...axis, boundaryGap: chartKind.value === 'bar' })

/* a palette that reads on paper and on the dark ground */
export const PALETTE = ['#0e8c8c', '#d97706', '#7c3aed', '#059669', '#e11d48', '#2563eb', '#a16207', '#0891b2', '#db2777', '#4b5563']

export function base() {
  const t = tokens()
  return {
    textStyle: { fontFamily: t.mono, color: t.ink3, fontSize: 11 },
    color: PALETTE,
    grid: { left: 8, right: 12, top: 28, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis', backgroundColor: t.paper, borderColor: t.hair, textStyle: { color: t.ink, fontFamily: t.mono, fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: t.ink3, type: 'dashed' } },
    },
    legend: { top: 0, left: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: t.ink2, fontFamily: t.mono, fontSize: 11 } },
    xAxis: { type: 'category', boundaryGap: false, axisLine: { lineStyle: { color: t.hair } }, axisTick: { show: false }, axisLabel: { color: t.ink3, hideOverlap: true } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: t.hair } }, axisLabel: { color: t.ink3 }, minInterval: 1 },
  }
}
