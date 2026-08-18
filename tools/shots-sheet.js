// Does the shot list actually sort a pile of frames correctly?
//
//   node tools/shots-sheet.js <dir-of-pngs> [out.png]
//
// Feeds every frame through the real pipeline, lets `assignShots` decide which
// frame belongs in which slot, and writes one row per slot — the frame it chose,
// its cutout — plus the pet built from the four of them together. This is the
// test of the whole guided-capture idea: if the wrong frames land in the slots,
// the interface is asking for the wrong things.

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

const { toSmall, shrinkMask } = await import('../analyzer/segment.js')
const { readFromShots } = await import('../analyzer/analyze.js')
const { SHOTS, shapeOf, scoreShot, assignShots } = await import('../analyzer/shots.js')
const Vision = await import('../analyzer/vision.js')

const dir = process.argv[2] || '/tmp/petframes'
const outPath = process.argv[3] || '/tmp/sa-shots.png'

console.log('loading the models…')
if (!await Vision.prepare(s => process.stdout.write(`\r${s}          `))) {
  console.error('\nvision unavailable:', Vision.vision.error)
  process.exit(1)
}
console.log('\nreading frames…')

/// Mean absolute Laplacian: a blurred frame has little high-frequency energy.
function sharpness (image) {
  const { width: w, height: h, data } = image
  const lum = i => 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]
  let sum = 0, count = 0
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x
      sum += Math.abs(4 * lum(i) - lum(i - 1) - lum(i + 1) - lum(i - w) - lum(i + w))
      count++
    }
  }
  return count ? sum / count : 0
}

const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png')).sort()
const candidates = []
let sharpest = 1

for (const name of files) {
  const image = decodePNG(readFileSync(join(dir, name)))
  const small = toSmall(image, 220)
  let read = null
  try { read = await Vision.readPhoto(image) } catch { /* skip */ }
  if (!read) { console.log(`   ${name}: no animal found`); continue }

  const mask = shrinkMask(read.mask, { width: read.width, height: read.height }, small)
  const shape = shapeOf(mask, small.width, small.height)
  const sharp = sharpness(small)
  sharpest = Math.max(sharpest, sharp)
  candidates.push({ name, image, small, mask, shape, sharp, species: read.species })
}

// Quality is relative within the pile, which is the point: frames from one video
// share lighting and subject, so comparing them to each other is reliable in a way
// that comparing them to an absolute threshold is not.
for (const c of candidates) c.quality = c.sharp / sharpest

const { filled, missing } = assignShots(candidates)
const votes = candidates.map(c => c.species)
const species = votes.filter(v => v === 'dog').length * 2 > votes.length ? 'dog' : 'cat'

console.log(`\n${candidates.length} usable frames · species voted "${species}"`)
for (const shot of SHOTS) {
  const chosen = filled[shot.id]
  const scores = chosen ? scoreShot(chosen.shape) : null
  console.log(`  ${shot.id.padEnd(6)} ${chosen ? chosen.name : '— nothing suitable'}` +
    (chosen ? `  aspect ${chosen.shape.aspect.toFixed(2)} fill ${chosen.shape.fill.toFixed(2)} coverage ${chosen.shape.coverage.toFixed(2)} score ${scores[shot.id].toFixed(2)}` : ''))
}
if (missing.length) console.log(`  missing essentials: ${missing.join(', ')}`)

const reading = readFromShots(
  Object.fromEntries(Object.entries(filled).map(([id, c]) => [id, { image: c.small, mask: c.mask }])),
  { species }
)
console.log('\nwhat it measured:')
for (const n of reading.notes) console.log(`   · ${n}`)
console.log(`   parameters actually measured: ${reading.measured.join(', ')}`)

// ---- sheet ----

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

const blank = { rgba: new Uint8ClampedArray(4), size: 1 }
const tiles = []
for (const shot of SHOTS) {
  const c = filled[shot.id]
  tiles.push(c ? squareify(c.image.data, c.image.width, c.image.height) : blank)
  tiles.push(c ? squareify(cutout(c.image, c.mask, c.small), c.image.width, c.image.height) : blank)
}
// The pet the four of them produced, twice the size, in the last row.
tiles.push(renderFrame(reading.appearance, { animation: 'sit', frame: 0, facing: 1, quality: 0.8 }))
tiles.push(renderFrame(reading.appearance, { animation: 'walk', frame: 3, facing: 1, quality: 0.8 }))

const out = sheet(tiles, { cols: 2, cell: 230 })
writeFileSync(outPath, encodePNG(out.rgba, out.width, out.height))
console.log(`\nwrote ${outPath}  ${out.width}x${out.height}`)
console.log(`rows: ${SHOTS.map(s => s.id).join(', ')}, then the pet they produced`)
