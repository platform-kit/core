import assert from 'node:assert/strict'
import { launch, context } from './browser.mjs'
import { preserveMutedMedia } from './prerender-media.mjs'

const browser = await launch()
try {
  const ctx = await context(browser)
  const page = await ctx.newPage()
  await page.setContent('<video id="quiet" autoplay></video><audio id="quiet-audio"></audio><video id="sound" muted></video>')
  await page.evaluate(() => {
    document.querySelector<HTMLVideoElement>('#quiet')!.muted = true
    document.querySelector<HTMLAudioElement>('#quiet-audio')!.muted = true
    document.querySelector<HTMLVideoElement>('#sound')!.muted = false
  })
  await page.evaluate(preserveMutedMedia)
  const html = await page.content()
  await page.setContent(html)
  const states = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLMediaElement>('video, audio'), (m) => ({
    id: m.id, muted: m.muted, defaultMuted: m.defaultMuted,
  })))
  assert.deepEqual(states, [
    { id: 'quiet', muted: true, defaultMuted: true },
    { id: 'quiet-audio', muted: true, defaultMuted: true },
    { id: 'sound', muted: false, defaultMuted: false },
  ])
  await ctx.close()
  console.log('prerender-media: muted state survives serialization')
} finally {
  await browser.close()
}
