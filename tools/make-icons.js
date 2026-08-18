// Builds the app icons out of the engine itself, so the icon is a real pet drawn
// by the same code that draws the pets — nothing to keep in sync, and no binary
// art assets in the repository.
//
//   node tools/make-icons.js
//
// Writes desktop/build/icon.icns (macOS, via iconutil) and icon.ico (Windows).
// Also writes icon.png, which electron-builder falls back to on Linux.

import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { renderFrame, defaultCat, fromHex, CoatPattern } from '../engine/index.js'
import { encodePNG } from './png.js'

const MOMO = {
  ...defaultCat(),
  pattern: CoatPattern.tabby,
  base: fromHex(0xc9884a),
  accent: fromHex(0x8c5626),
  eye: fromHex(0x9aa863),
  nose: fromHex(0xe6a79c),
  size: 1.0,
  build: 0.2,
  capCoverage: 0.5,
  faceBlaze: 0.5,
  saddle: 0.62,
  chestWhite: 0.9,
  socks: 0.95,
  tailBands: 0.45,
  patternContrast: 0.6,
  earNotch: 0.5,
}

/// Nearest-neighbour-free box resample down from one big render, so every size
/// stays smooth rather than being re-rendered at a grid too small to hold a face.
function resample (tile, size) {
  const out = new Uint8ClampedArray(size * size * 4)
  const ratio = tile.size / size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0
      const x0 = Math.floor(x * ratio), x1 = Math.max(x0 + 1, Math.floor((x + 1) * ratio))
      const y0 = Math.floor(y * ratio), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ratio))
      for (let sy = y0; sy < Math.min(tile.size, y1); sy++) {
        for (let sx = x0; sx < Math.min(tile.size, x1); sx++) {
          const i = (sy * tile.size + sx) * 4
          const alpha = tile.rgba[i + 3] / 255
          r += tile.rgba[i] * alpha; g += tile.rgba[i + 1] * alpha; b += tile.rgba[i + 2] * alpha
          a += tile.rgba[i + 3]; n++
        }
      }
      const d = (y * size + x) * 4
      const alpha = a / Math.max(1, n)
      const weight = Math.max(1e-6, alpha / 255) * Math.max(1, n)
      out[d] = r / weight
      out[d + 1] = g / weight
      out[d + 2] = b / weight
      out[d + 3] = alpha
    }
  }
  return out
}

const master = renderFrame(MOMO, { animation: 'sit', frame: 0, facing: 1, quality: 4 })
console.log(`master render: ${master.size}px`)

mkdirSync('desktop/build', { recursive: true })

const sizes = [16, 32, 64, 128, 256, 512, 1024]
const pngs = new Map()
for (const size of sizes) {
  pngs.set(size, encodePNG(resample(master, size), size, size))
}
writeFileSync('desktop/build/icon.png', pngs.get(1024))

// ---- macOS .icns, assembled with the system tool ----
try {
  const set = 'desktop/build/icon.iconset'
  rmSync(set, { recursive: true, force: true })
  mkdirSync(set, { recursive: true })
  const plan = [
    [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
  ]
  for (const [size, name] of plan) writeFileSync(`${set}/${name}`, pngs.get(size))
  execFileSync('iconutil', ['-c', 'icns', set, '-o', 'desktop/build/icon.icns'])
  rmSync(set, { recursive: true, force: true })
  console.log('wrote desktop/build/icon.icns')
} catch (err) {
  console.warn(`skipped icon.icns (${err.message}) — iconutil only exists on macOS`)
}

// ---- Windows .ico ----
// An ICO may embed PNGs directly, which avoids writing a BMP encoder. Windows has
// accepted this since Vista.
function buildICO (entries) {
  const count = entries.length
  const header = Buffer.alloc(6 + count * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  let offset = header.length
  const bodies = []
  entries.forEach(([size, png], i) => {
    const at = 6 + i * 16
    header[at] = size >= 256 ? 0 : size      // 0 means 256
    header[at + 1] = size >= 256 ? 0 : size
    header[at + 2] = 0                        // palette
    header[at + 3] = 0
    header.writeUInt16LE(1, at + 4)           // colour planes
    header.writeUInt16LE(32, at + 6)          // bits per pixel
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
    bodies.push(png)
  })
  return Buffer.concat([header, ...bodies])
}

writeFileSync('desktop/build/icon.ico', buildICO(
  [16, 32, 64, 128, 256].map(size => [size, pngs.get(size)])
))
console.log('wrote desktop/build/icon.ico and icon.png')
