/*
 * Cover-image processing for the books collection.
 *
 * A book's frontmatter points at an image sitting next to its markdown
 * (cover: ./the-kybalion.jpg). At build time this resizes it down to a sane
 * max width, re-encodes it as webp, and writes it into velite's own asset
 * directory (public/static, cleaned each build) under a content-hashed name.
 * It returns the object the components render: the URL, the real dimensions
 * (so covers never cause layout shift) and a tiny blur placeholder.
 *
 * velite's built-in s.image() moves and hashes but never resizes or compresses;
 * this does, using the sharp that velite already depends on.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import sharp from 'sharp'
import { getImageMetadata } from 'velite'

const OUT_DIR = 'public/static'   // velite's assets dir — matches output.assets
const BASE = '/static/'           // matches output.base
const MAX_WIDTH = 640             // a cover is never drawn wider than this (with 2x headroom)
const QUALITY = 80

export async function processCover(absSrc) {
  const input = await readFile(absSrc)
  const out = await sharp(input)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer()
  const meta = await getImageMetadata(out)   // { width, height, blurDataURL }
  const hash = createHash('sha256').update(out).digest('hex').slice(0, 8)
  const name = basename(absSrc, extname(absSrc)) + '-' + hash + '.webp'
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(join(OUT_DIR, name), out)
  const width = meta?.width ?? null
  const height = meta?.height ?? null
  return {
    src: BASE + name,
    width,
    height,
    aspectRatio: width && height ? width / height : null,
    blurDataURL: meta?.blurDataURL ?? null,
  }
}
