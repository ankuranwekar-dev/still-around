// Before and after, on real photographs, as one image you can look at.
//
//   node tools/vision-sheet.js <dir-of-pngs> [out.png] [limit]
//
// Four columns per photo: the photograph, the classical cutout, the cutout the
// vision models produce, and the pet built from the vision cutout. This runs the
// same `analyzer/vision.js` the website runs — the module loads the installed
// transformers.js package under Node and falls back to a CDN in a browser — so
// what is measured here is what visitors get, not an approximation of it.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { renderFrame } from '../engine/index.js'
import { encodePNG, decodePNG, sheet } from './png.js'

globalThis.ImageData = class {
  constructor (a, b, c) {
    if (typeof a === 'number') { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4) }
    else { this.data = a; this.width = b; this.height = c }
  }
}

const { segment, toSmall, shrinkMask } = await import('../analyzer/segment.js')
const { readAppearance } = await import('../analyzer/analyze.js')
const Vision = await import('../analyzer/vision.js')

// ---- run -------------------------------------------------------------------

const dir = process.argv[2] || '/tmp/petframes'
const outPath = process.argv[3] || '/tmp/sa-vision.png'
const limit = Number(process.argv[4] || 6)

console.log('loading the models…')
const ready = await Vision.prepare(s => process.stdout.write(`\r${s}          `))
console.log(`\nvision: ${ready ? 'ready' : 'unavailable — ' + Vision.vision.error}`)
if (!ready) process.exit(1)

const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png')).sort()
// One frame per clip, so the sheet covers as many different scenes as possible.
const perClip = new Map()
for (const f of files) if (!perClip.has(f.slice(0, 8))) perClip.set(f.slice(0, 8), f)
const chosen = [...perClip.entries()].slice(0, limit)

const CELL = 210
const tiles = []

function cutout (image, mask, small) {
  const out = new Uint8ClampedArray(image.data.length)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4
      const mx = Math.min(small.width - 1, Math.floor((x / image.width) * small.width))
      const my = Math.min(small.height - 1, Math.floor((y / image.height) * small.height))
      const on = mask[my * small.width + mx]
      out[i] = on ? image.data[i] : image.data[i] * 0.13 + 12
      out[i + 1] = on ? image.data[i + 1] : image.data[i + 1] * 0.13 + 16
      out[i + 2] = on ? image.data[i + 2] : image.data[i + 2] * 0.13 + 22
      out[i + 3] = 255
    }
  }
  return out
}

function squareify (data, w, h) {
  const size = Math.max(w, h)
  const out = new Uint8ClampedArray(size * size * 4)
  const ox = Math.floor((size - w) / 2), oy = Math.floor((size - h) / 2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      const d = ((y + oy) * size + x + ox) * 4
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = 255
    }
  }
  return { rgba: out, size }
}

for (const [clip, name] of chosen) {
  const image = decodePNG(readFileSync(join(dir, name)))
  const small = toSmall(image, 220)

  // 1. the classical cutout, for comparison
  const classical = segment(small)

  // 2. the models
  let visionMask = null
  let detail = 'no cat or dog found'
  try {
    const read = await Vision.readPhoto(image)
    if (read) {
      visionMask = shrinkMask(read.mask, { width: read.width, height: read.height }, small)
      detail = `${read.species} ${(read.score * 100) | 0}% · fill ${read.fill.toFixed(2)} spill ${read.spill.toFixed(2)}${read.uncertain ? ' · uncertain' : ''}`
    }
  } catch (err) {
    detail = `failed: ${err.message}`
  }

  const before = readAppearance([{ image: small, mask: classical.mask }], { species: 'cat' })
  const after = visionMask
    ? readAppearance([{ image: small, mask: visionMask }], { species: 'cat' })
    : null

  tiles.push(squareify(image.data, image.width, image.height))
  tiles.push(squareify(cutout(image, classical.mask, small), image.width, image.height))
  tiles.push(visionMask
    ? squareify(cutout(image, visionMask, small), image.width, image.height)
    : { rgba: new Uint8ClampedArray(4), size: 1 })
  tiles.push(renderFrame((after || before).appearance, {
    animation: 'sit', frame: 0, facing: 1, quality: 0.75,
  }))

  const colour = r => r ? r.notes.find(n => n.startsWith('base')) || '' : 'n/a'
  console.log(`\n=== ${clip} ===`)
  console.log(`   vision:    ${detail}`)
  console.log(`   classical: ${colour(before)}`)
  console.log(`   vision:    ${colour(after)}`)
}

const out = sheet(tiles, { cols: 4, cell: CELL })
writeFileSync(outPath, encodePNG(out.rgba, out.width, out.height))
console.log(`\nwrote ${outPath}  ${out.width}x${out.height}`)
console.log('columns: photo | classical cutout | vision cutout | pet from the vision cutout')
