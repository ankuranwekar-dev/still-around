// Shared live loop: one three.js renderer, N stage3 pets, resize, LOD.

import { createRenderer } from './renderer.js'
import { setupScene, addContactShadow } from './scene.js'

export async function attachLoop (THREE, canvas, stages, {
  alpha = false, forceWebGL = false, lod = 1, spread,
} = {}) {
  const { renderer } = await createRenderer(THREE, canvas, {
    width: Math.max(1, canvas.clientWidth),
    height: Math.max(1, canvas.clientHeight),
    dpr: Math.min(2, window.devicePixelRatio || 1),
    alpha,
    forceWebGL,
  })
  if (alpha) renderer.setClearColor(0x000000, 0)
  const { scene, camera } = setupScene(THREE, { alpha })
  if (alpha) scene.background = null
  addContactShadow(THREE, scene, 0.18)
  for (const s of stages) scene.add(s.root)

  function resize () {
    const w = Math.max(1, canvas.clientWidth)
    const h = Math.max(1, canvas.clientHeight)
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    const y = 0.16
    camera.position.set(0.02, y + 0.12, 0.85)
    camera.lookAt(0, y, 0)
  }
  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)

  let last = performance.now()
  let running = true
  let focused = true
  function frame (now) {
    if (!running) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const w = spread ?? Math.max(0.8, canvas.clientWidth / 700)
    for (const s of stages) {
      s.tick(dt, { width: w })
      if (s.root.parent !== scene) scene.add(s.root)
    }
    renderer.render(scene, camera)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  return {
    scene, camera, renderer, stages,
    setFocused (on) {
      focused = on
      const level = on ? lod : 0
      for (const s of stages) s.setLod?.(level)
    },
    stop () {
      running = false
      ro.disconnect()
      renderer.dispose()
    },
  }
}
