// Frame-time harness for engine3. 600 frames at 512px, report percentiles and
// draw calls, exit 1 if p95 exceeds the overlay budget.
//
//   node tools/perf3d.js
//   node tools/perf3d.js --frames 600 --size 512 --budget 8

import { withHarness, flags } from './harness3d.js'
import { isSoftwareGpu } from '../engine3/renderer.js'

const args = flags()
const frames = Number(args.frames || 600)
const size = Number(args.size || 512)
const dpr = Number(args.dpr || 2)
const budget = Number(args.budget || 8)
const scene = args.scene || 'sphere'

const result = await withHarness({ scene, gl: args.gl || 'auto' }, page =>
  page.evaluate(async opts => window.__engine3.runPerf(opts), { frames, size, dpr }),
)

const fmt = ms => `${ms.toFixed(2)}ms`
console.log(`scene ${scene}  ${result.frames} frames @ ${result.size}px  dpr ${result.dpr}`)
console.log(`backend ${result.backend}  chromium ${result.chromium}`)
console.log(`gpu: ${result.gpu}`)
console.log(`p50 ${fmt(result.p50)}  p95 ${fmt(result.p95)}  p99 ${fmt(result.p99)}  mean ${fmt(result.mean)}`)
console.log(`min ${fmt(result.min)}  max ${fmt(result.max)}`)
console.log(`draw calls ${result.drawCalls}  triangles ${result.triangles}`)
console.log(`budget p95 ≤ ${budget}ms`)

if (result.p95 > budget) {
  if (isSoftwareGpu(result.gpu)) {
    console.warn(`over budget on software GL (${result.gpu}). The 8ms gate is for M1 integrated graphics; re-run with a real GPU before calling a render-path change done.`)
  }
  process.exit(1)
}
