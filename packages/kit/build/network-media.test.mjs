/* WHAT A POST MAY CARRY, AND HOW IT GOES OVER THE PROTOCOL (openspec: streamline-social-layout).
   The limits and kinds a composer refuses by, the shape one item is shown at, and the record each
   mix of media becomes on the wider network: four pictures, one video, or the first four pictures
   and a link to the whole post. Pure: the one module the browser and the functions both read. */
import { MEDIA, refuseMedia, shapeOf, planEmbed, kindOf, kindOfType } from '../supabase/functions/_shared/atproto/media.js'

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const img = (n = 1, w = 1200, h = 900) => Array.from({ length: n }, (_, i) => ({ kind: 'image', path: 'p' + i, width: w, height: h }))
const vid = (n = 1) => Array.from({ length: n }, (_, i) => ({ kind: 'video', path: 'v' + i, width: 1080, height: 1920 }))

/* the limits */
ok('a post carries up to ten', MEDIA.max === 10 && refuseMedia(Array(10).fill({ type: 'image/jpeg', size: 1 })) === null)
ok('…and not eleven', refuseMedia(Array(11).fill({ type: 'image/jpeg', size: 1 })) === 'media-many')
ok('…counting what the post already holds', refuseMedia([{ type: 'image/png', size: 1 }], 10) === 'media-many')
ok('a picture over 10 MB is refused', refuseMedia([{ type: 'image/png', size: 10 * 1024 * 1024 + 1 }]) === 'media-big')
ok('a video up to 100 MB is not', refuseMedia([{ type: 'video/mp4', size: 99 * 1024 * 1024 }]) === null)
ok('…and over it is', refuseMedia([{ type: 'video/mp4', size: 101 * 1024 * 1024 }]) === 'media-big')
ok('a video over three minutes is refused', refuseMedia([{ type: 'video/webm', size: 1, duration: 181 }]) === 'media-long')
ok('a kind it does not carry is refused by name', refuseMedia([{ type: 'application/pdf', size: 1 }]) === 'media-kind')
ok('the kinds: pictures and videos', kindOfType('image/gif') === 'image' && kindOfType('video/quicktime') === 'video' && kindOfType('audio/mpeg') === null)
ok('an item saved before videos is a picture', kindOf({ path: 'x' }) === 'image')

/* the shape one item shows at */
ok('a square picture is square', shapeOf({ width: 800, height: 800 }) === 1)
ok('a landscape picture keeps its shape', Math.abs(shapeOf({ width: 1600, height: 1000 }) - 1.6) < 1e-9)
ok('a panorama is held at 1.91:1', shapeOf({ width: 4000, height: 1000 }) === 1.91)
ok('a tall picture is held at 4:5', shapeOf({ width: 1080, height: 1920 }) === 0.8)
ok('one with no size is square', shapeOf({}) === 1)

/* over the protocol */
const p1 = planEmbed(img(3))
ok('three pictures go as three pictures', p1.images.length === 3 && !p1.video && !p1.link)
const p2 = planEmbed(img(4))
ok('four go as four', p2.images.length === 4 && !p2.link)
const p3 = planEmbed(img(6))
ok('six go as the first four and a link', p3.images.length === 4 && p3.images[0].path === 'p0' && p3.link === true)
const p4 = planEmbed(vid(1))
ok('one video goes as one video', p4.video && p4.video.path === 'v0' && !p4.images.length && !p4.link)
const p5 = planEmbed([...img(2), ...vid(1)])
ok('pictures and a video go as the pictures and a link', p5.images.length === 2 && !p5.video && p5.link === true)
const p6 = planEmbed(vid(2))
ok('two videos go as a link alone', p6.images.length === 0 && !p6.video && p6.link === true)
ok('no media, no embed', planEmbed([]) === null && planEmbed(null) === null)

console.log(`network-media: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
