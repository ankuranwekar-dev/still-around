// Headless contact sheet for engine3. This is the agent's eyes: art changes
// are not done until this PNG has been looked at.
//
//   node tools/shot3d.js [out.png]
//   node tools/shot3d.js --scene sphere --gl auto
//   node tools/shot3d.js --sheet sphere

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { withHarness, flags, dataUrlToBuffer } from './harness3d.js'

const SHEETS = {
  sphere: { scene: 'sphere' },
}

const args = flags()
const sheetName = args.sheet === true ? 'sphere' : (args.sheet || 'sphere')
if (!SHEETS[sheetName]) {
  console.error(`unknown sheet "${sheetName}". known: ${Object.keys(SHEETS).join(', ')}`)
  process.exit(2)
}
const scene = args.scene || SHEETS[sheetName].scene
const out = args.positional[0] || '/tmp/still-around-shot3d.png'
const cell = Number(args.size || 256)
const dpr = Number(args.dpr || 2)

const result = await withHarness({ scene, gl: args.gl || 'auto' }, page =>
  page.evaluate(async opts => window.__engine3.renderSheet(opts), { cell, dpr }),
)

if (result.black) {
  console.error(`black frame (mean luma ${result.meanLuma.toFixed(2)}) on ${result.chromium} / ${result.backend} / ${result.gpu}`)
  process.exit(1)
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, dataUrlToBuffer(result.png))
console.log(`wrote ${out}  ${result.width}x${result.height}`)
console.log(`scene ${scene}  backend ${result.backend}  chromium ${result.chromium}`)
console.log(`gpu: ${result.gpu}`)
console.log(`views: ${result.views.join(' | ')}`)
console.log(`mean luma ${result.meanLuma.toFixed(1)}`)
