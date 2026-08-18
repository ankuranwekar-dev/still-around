// Runs the browser analyzer against real photographs, under Node.
//
// The point is to be able to judge the likeness by looking at a photo next to the
// pet it produced, without a browser in the loop. This is the same harness idea
// that got the native version's colour reading from "muddy grey" to "warm ginger";
// guessing at these numbers without measuring them does not work.
//
//   node tools/test-analyzer.js <dir-of-pngs> [out.png]

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { join } from 'node:path'
import { renderFrame } from '../engine/index.js'
import { encodePNG, sheet } from './png.js'

// ---- a small PNG reader, so the harness needs nothing installed ------------

function decodePNG (buffer) {
  let pos = 8 // skip signature
  let width = 0, height = 0, bitDepth = 8, colourType = 6
  const idat = []
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colourType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType]
  if (!channels) throw new Error(`unsupported colour type ${colourType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8ClampedArray(width * height * 4)
  const prior = new Uint8Array(stride)
  const line = new Uint8Array(stride)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prior[i]
      const c = i >= channels ? prior[i - channels] : 0
      let v = src[i]
      switch (filter) {
        case 1: v += a; break
        case 2: v += b; break
        case 3: v += (a + b) >> 1; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          break
        }
      }
      line[i] = v & 0xff
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels
      const d = (y * width + x) * 4
      if (channels >= 3) {
        out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]
        out[d + 3] = channels === 4 ? line[s + 3] : 255
      } else {
        out[d] = out[d + 1] = out[d + 2] = line[s]
        out[d + 3] = channels === 2 ? line[s + 1] : 255
      }
    }
    prior.set(line)
  }
  return { width, height, data: out }
}

// ---- the one browser global the analyzer touches ---------------------------
// segment.js is otherwise pure: it takes ImageData in and gives ImageData back,
// with no canvas anywhere, which is what lets this harness exist at all.

globalThis.ImageData = class {
  constructor (a, b, c) {
    if (typeof a === 'number') { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4) }
    else { this.data = a; this.width = b; this.height = c }
  }
}

function resize (image, width) {
  const w = Math.min(width, image.width)
  const h = Math.max(1, Math.round(w * (image.height / image.width)))
  const out = new Uint8ClampedArray(w * h * 4)
  const sx = image.width / w, sy = image.height / h
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0
      for (let oy = Math.floor(y * sy); oy < Math.min(image.height, Math.floor((y + 1) * sy)); oy++) {
        for (let ox = Math.floor(x * sx); ox < Math.min(image.width, Math.floor((x + 1) * sx)); ox++) {
          const i = (oy * image.width + ox) * 4
          r += image.data[i]; g += image.data[i + 1]; b += image.data[i + 2]; n++
        }
      }
      const d = (y * w + x) * 4
      out[d] = r / Math.max(1, n); out[d + 1] = g / Math.max(1, n); out[d + 2] = b / Math.max(1, n); out[d + 3] = 255
    }
  }
  return new globalThis.ImageData(out, w, h)
}

const { segment } = await import('../analyzer/segment.js')
const { readAppearance } = await import('../analyzer/analyze.js')

// ---- run ------------------------------------------------------------------

const dir = process.argv[2] || '/tmp/petframes'
const outPath = process.argv[3] || '/tmp/sa-likeness.png'

const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png')).sort()
const groups = new Map()
for (const f of files) {
  const key = f.slice(0, 8)
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(f)
}

const tiles = []
const CELL = 190

for (const [key, names] of [...groups].sort()) {
  const photos = names.map(n => {
    const image = resize(decodePNG(readFileSync(join(dir, n))), 220)
    const { mask, confident } = segment(image)
    return { image, mask, confident }
  })

  const { appearance, notes } = readAppearance(photos, { species: 'cat' })
  const pet = renderFrame(appearance, { animation: 'sit', frame: 0, facing: 1, quality: 0.7 })

  // Photo on the left, cutout in the middle, rendered pet on the right — so a bad
  // result can be blamed on the right stage.
  const first = photos[0]
  const cut = new Uint8ClampedArray(first.image.data.length)
  for (let i = 0; i < first.mask.length; i++) {
    const o = i * 4
    const on = first.mask[i]
    cut[o] = on ? first.image.data[o] : 26
    cut[o + 1] = on ? first.image.data[o + 1] : 30
    cut[o + 2] = on ? first.image.data[o + 2] : 36
    cut[o + 3] = 255
  }

  tiles.push(squareify(first.image.data, first.image.width, first.image.height))
  tiles.push(squareify(cut, first.image.width, first.image.height))
  tiles.push(pet)

  console.log(`\n=== ${key} (${names.length} frames) ===`)
  for (const n of notes) console.log(`   · ${n}`)
}

/// The sheet helper wants square tiles; letterbox rather than distort.
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

const out = sheet(tiles, { cols: 3, cell: CELL })
writeFileSync(outPath, encodePNG(out.rgba, out.width, out.height))
console.log(`\nwrote ${outPath}  ${out.width}x${out.height}`)
console.log('columns: photo | what it cut out | the pet it built')
