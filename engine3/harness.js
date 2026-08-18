// In-page driver for the Playwright harness. Loads a scene module, renders
// named camera views into a labelled contact sheet, and times a frame loop.
// The Node tools only boot Chromium and write the bytes; they do not contain art.

import * as THREE from 'three/webgpu'
import { createRenderer, describeGpu } from './renderer.js'
import { loadScene } from './scenes.js'

const params = new URLSearchParams(location.search)
const sceneName = params.get('scene') || 'sphere'
const glPref = params.get('gl') || 'auto'

const work = document.createElement('canvas')
document.body.appendChild(work)

const ready = boot().catch(err => {
  console.error(err)
  window.__engine3 = { ready: true, error: String(err && err.stack || err) }
})

async function boot () {
  const forceWebGL = glPref === 'webgl' || glPref === 'swiftshader'
  window.__engine3 = {
    ready: false,
    THREE,
    renderSheet,
    runPerf,
    sceneName,
    glPref,
    forceWebGL,
  }
  window.__engine3.ready = true
}

async function makeWorld ({ cell = 256, dpr = 2, forceWebGL }) {
  const { renderer, backend } = await createRenderer(THREE, work, {
    width: cell,
    height: cell,
    dpr,
    forceWebGL,
  })
  const mod = await loadScene(sceneName)
  const world = mod.create(THREE)
  world.camera.aspect = 1
  world.camera.updateProjectionMatrix()
  const gpu = describeGpu(renderer)
  return { renderer, backend, gpu, world, views: mod.views, name: mod.name }
}

async function renderSheet ({
  cell = 256, dpr = 2, cols = 4, pad = 10, labelH = 22, titleH = 28,
} = {}) {
  const forceWebGL = glPref === 'webgl' || glPref === 'swiftshader'
  let worldPack
  try {
    worldPack = await makeWorld({ cell, dpr, forceWebGL })
  } catch (err) {
    if (forceWebGL) throw err
    worldPack = await makeWorld({ cell, dpr, forceWebGL: true })
  }
  const { renderer, backend, gpu, world, views, name } = worldPack

  const rows = Math.ceil(views.length / cols)
  const width = cols * (cell + pad) + pad
  const height = titleH + rows * (cell + labelH + pad) + pad
  const sheet = document.createElement('canvas')
  sheet.width = Math.round(width * dpr)
  sheet.height = Math.round(height * dpr)
  const ctx = sheet.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.fillStyle = '#1e2228'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#c8cdd3'
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText(`engine3 · ${name} · ${backend} · ${gpu}`, pad, titleH / 2)

  let lumaSum = 0
  let lumaN = 0

  for (let i = 0; i < views.length; i++) {
    const view = views[i]
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = pad + col * (cell + pad)
    const y = titleH + pad + row * (cell + labelH + pad)
    world.setView(view)
    renderer.render(world.scene, world.camera)
    ctx.drawImage(work, x, y, cell, cell)

    const sample = ctx.getImageData(
      Math.round((x + cell * 0.35) * dpr),
      Math.round((y + cell * 0.35) * dpr),
      Math.max(1, Math.round(cell * 0.3 * dpr)),
      Math.max(1, Math.round(cell * 0.3 * dpr)),
    ).data
    for (let p = 0; p < sample.length; p += 4) {
      lumaSum += 0.2126 * sample[p] + 0.7152 * sample[p + 1] + 0.0722 * sample[p + 2]
      lumaN++
    }

    ctx.fillStyle = '#9aa3ad'
    ctx.textAlign = 'center'
    ctx.fillText(view.label, x + cell / 2, y + cell + labelH * 0.55)
    ctx.textAlign = 'left'
  }

  const meanLuma = lumaN ? lumaSum / lumaN : 0
  const png = sheet.toDataURL('image/png')
  world.dispose()
  renderer.dispose()
  return {
    png,
    width: sheet.width,
    height: sheet.height,
    backend,
    gpu,
    meanLuma,
    black: meanLuma < 4,
    views: views.map(v => v.label),
  }
}

async function runPerf ({ frames = 600, size = 512, dpr = 2 } = {}) {
  const forceWebGL = glPref === 'webgl' || glPref === 'swiftshader'
  let worldPack
  try {
    worldPack = await makeWorld({ cell: size, dpr, forceWebGL })
  } catch (err) {
    if (forceWebGL) throw err
    worldPack = await makeWorld({ cell: size, dpr, forceWebGL: true })
  }
  const { renderer, backend, gpu, world } = worldPack
  world.setView({ yaw: Math.PI / 5, pitch: 0.18 })

  const times = []
  let drawCalls = 0
  let triangles = 0

  const warmup = 30
  for (let i = 0; i < warmup; i++) {
    world.tick(i / warmup)
    renderer.render(world.scene, world.camera)
    await gpuFlush(renderer)
  }

  renderer.info.autoReset = false
  for (let i = 0; i < frames; i++) {
    renderer.info.reset()
    const t0 = performance.now()
    world.tick(i / frames)
    renderer.render(world.scene, world.camera)
    await gpuFlush(renderer)
    times.push(performance.now() - t0)
    drawCalls = renderer.info.render.drawCalls
    triangles = renderer.info.render.triangles
  }

  times.sort((a, b) => a - b)
  const pct = p => {
    const i = (times.length - 1) * p
    const lo = Math.floor(i)
    const hi = Math.ceil(i)
    if (lo === hi) return times[lo]
    return times[lo] + (times[hi] - times[lo]) * (i - lo)
  }
  const sum = times.reduce((a, b) => a + b, 0)

  world.dispose()
  renderer.dispose()
  return {
    backend,
    gpu,
    frames,
    size,
    dpr,
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
    mean: sum / times.length,
    min: times[0],
    max: times[times.length - 1],
    drawCalls,
    triangles,
  }
}

async function gpuFlush (renderer) {
  const gl = renderer.backend?.gl
  if (gl && typeof gl.finish === 'function') {
    gl.finish()
    return
  }
  const device = renderer.backend?.device
  if (device?.queue?.onSubmittedWorkDone) {
    await device.queue.onSubmittedWorkDone()
  }
}

await ready
