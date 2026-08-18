// Renders a contact sheet of test pets so the engine can be judged by looking
// rather than by hoping. This is how the whole art pipeline was tuned; it is far
// faster than opening the app.
//
//   node tools/sheet.js [out.png]

import { writeFileSync } from 'node:fs'
import { renderFrame, defaultCat, defaultDog, fromHex, CoatPattern, EarStyle, TailStyle } from '../engine/index.js'
import { encodePNG, sheet } from './png.js'

const pets = [
  ['ginger tabby & white', {
    ...defaultCat(),
    pattern: CoatPattern.tabby,
    base: fromHex(0xc98a4b), accent: fromHex(0x8a5a2a),
    eye: fromHex(0x9dae72), capCoverage: 0.5, faceBlaze: 0.45,
    chestWhite: 0.85, socks: 0.9, tailBands: 0.5, patternContrast: 0.6,
  }],
  ['calico', {
    ...defaultCat(),
    pattern: CoatPattern.calico,
    base: fromHex(0xa08a72), accent: fromHex(0xc07a3a),
    eye: fromHex(0x8fae6a), capCoverage: 0.62, faceBlaze: 0.5,
    chestWhite: 0.7, socks: 0.6, patchiness: 0.65, patternContrast: 0.4,
  }],
  ['solid black', {
    ...defaultCat(),
    pattern: CoatPattern.solid,
    base: fromHex(0x2e2a28), accent: fromHex(0x1d1a18),
    eye: fromHex(0xc8a63c), capCoverage: 1, chestWhite: 0, socks: 0,
    patternContrast: 0, saddle: 1,
  }],
  ['tuxedo', {
    ...defaultCat(),
    pattern: CoatPattern.tuxedo,
    base: fromHex(0x232120), accent: fromHex(0x141312),
    eye: fromHex(0x7ba05b), capCoverage: 0.72, faceBlaze: 0.6,
    chestWhite: 0.95, socks: 1, patternContrast: 0,
  }],
  ['grey mackerel', {
    ...defaultCat(),
    pattern: CoatPattern.tabby,
    base: fromHex(0x8d8b86), accent: fromHex(0x5c5a56),
    eye: fromHex(0xb8a04c),
    capCoverage: 0.95, chestWhite: 0.2, patternContrast: 0.85, tailBands: 0.7,
  }],
  ['siamese', {
    ...defaultCat(),
    pattern: CoatPattern.pointed,
    base: fromHex(0x5a4436), accent: fromHex(0x3d2c22),
    eye: fromHex(0x6f9fc4), nose: fromHex(0x6b5248),
    capCoverage: 1, chestWhite: 0, patternContrast: 0.1,
  }],
  ['long-haired ginger', {
    ...defaultCat(),
    pattern: CoatPattern.tabby,
    base: fromHex(0xd08c46), accent: fromHex(0x9a5f28),
    eye: fromHex(0xc59a3e), furLength: 0.85, tailStyle: TailStyle.fluffy,
    build: 0.4, capCoverage: 0.85, chestWhite: 0.4, patternContrast: 0.35,
  }],
  ['folded ears, dilute', {
    ...defaultCat(),
    pattern: CoatPattern.tabby,
    earStyle: EarStyle.folded,
    base: fromHex(0xa9a2ad), accent: fromHex(0x746e79),
    eye: fromHex(0xc9a24a), capCoverage: 0.9, chestWhite: 0.3, patternContrast: 0.5,
  }],
  ['golden retriever', {
    ...defaultDog(),
    base: fromHex(0xd7a55e),
    accent: fromHex(0xb07f3c), eye: fromHex(0x5a3f2a),
    furLength: 0.6, tailStyle: TailStyle.fluffy, size: 1.25, build: 0.3,
    patternContrast: 0.04, capCoverage: 1, chestWhite: 0.22,
  }],
  ['beagle', {
    ...defaultDog(),
    pattern: CoatPattern.bicolour,
    base: fromHex(0x9a6a3a), accent: fromHex(0x33291f),
    eye: fromHex(0x4a3524), snout: 0.6, size: 1.0, patternContrast: 0.04,
    capCoverage: 0.8, faceBlaze: 0.55, chestWhite: 0.75, socks: 0.9, saddle: 0.6,
  }],
  ['black lab', {
    ...defaultDog(),
    base: fromHex(0x26241f), accent: fromHex(0x171612),
    eye: fromHex(0x7a5a34), size: 1.3, build: 0.35, snout: 0.8,
    capCoverage: 1, chestWhite: 0, patternContrast: 0,
  }],
  ['dachshund-ish', {
    ...defaultDog(),
    pattern: CoatPattern.bicolour,
    base: fromHex(0x7a3f22), accent: fromHex(0x2b1d16),
    eye: fromHex(0x3d2b1e), size: 0.8, build: -0.3, snout: 0.9, patternContrast: 0.04,
    capCoverage: 0.95, chestWhite: 0.25, socks: 0.3,
  }],
]

const poses = process.env.POSES ? process.env.POSES.split(',') : ['sit', 'walk', 'sleep', 'loaf']
const CELL = 150
const tiles = []
const labels = []

console.time('render')
const only = process.env.ONLY ? process.env.ONLY.split(',') : null
const chosen = only ? pets.filter(([n]) => only.some(o => n.includes(o))) : pets
for (const [name, appearance] of chosen) {
  for (const p of poses) {
    tiles.push(renderFrame(appearance, {
      animation: p,
      frame: p === 'walk' ? 3 : 0,
      facing: 1,
      quality: 0.62,
    }))
  }
  labels.push(name)
}
console.timeEnd('render')

const out = sheet(tiles, { cols: poses.length, cell: CELL })
const path = process.argv[2] || '/tmp/still-around-sheet.png'
writeFileSync(path, encodePNG(out.rgba, out.width, out.height))
console.log(`wrote ${path}  ${out.width}x${out.height}`)
console.log(`rows, top to bottom: ${labels.join(' | ')}`)
console.log(`columns: ${poses.join(' | ')}`)
