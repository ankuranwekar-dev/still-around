// The desktop overlay's renderer.
//
// Draws every enabled pet onto one full-screen transparent canvas and decides,
// frame by frame, whether the window should be solid to the mouse. That decision
// is the crux of the whole app: the window covers the entire work area, so if it
// stayed solid nothing on the desktop behind it could ever be clicked again.
//
// The engine is imported unchanged from the same folder the website uses.

import { createStage } from '../../../engine/stage.js'

const canvas = document.getElementById('stage')
const ctx = canvas.getContext('2d')

let pets = []
let settings = { activeFps: 30, idleFps: 8, scale: 0.14, speech: true }
let interactive = false
let lastActivity = 0

function fit () {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.round(window.innerWidth * dpr)
  canvas.height = Math.round(window.innerHeight * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
window.addEventListener('resize', fit)
fit()

async function load (payload) {
  settings = { ...settings, ...(payload.settings || {}) }
  const wanted = payload.pets || []

  // Keep the stages we already have, so a tray toggle does not re-render every
  // frame of every animation from scratch.
  const existing = new Map(pets.map(p => [p.id, p]))
  const next = []
  for (const [index, pet] of wanted.entries()) {
    const already = existing.get(pet.id)
    if (already) { next.push(already); continue }
    const stage = createStage({ appearance: pet.appearance, quality: 0.8 })
    stage.position = 0.28 + index * 0.2
    next.push({ id: pet.id, name: pet.name, stage })
  }
  pets = next

  // First clips first, so a newly imported pet appears immediately rather than
  // after the whole library has been drawn.
  window.still.log(`${pets.length} pet(s) on a ${window.innerWidth}x${window.innerHeight} stage`)
  try {
    await Promise.all(pets.map(p => p.stage.ensure(['sit', 'blink', 'walk', 'speak'])))
  } catch (err) {
    window.still.log(`could not build the first clips: ${err && err.stack ? err.stack : err}`)
    throw err
  }
  for (const p of pets) {
    p.stage.ensure(['lookAround', 'groom', 'loaf', 'sleep', 'stretch', 'purr',
      'slowBlink', 'trot', 'knead', 'startle'])
  }
}

window.still.onPets(load)
window.still.onWelcome(({ name }) => {
  const pet = pets.find(p => p.name === name) || pets[pets.length - 1]
  pet?.stage.say('hello')
})
window.still.getPets().then(load)

// ---- pointer handling
//
// Mouse events arrive here even while the window is ignoring them, because the
// main process forwards them. Hit-testing is a box around each pet rather than a
// per-pixel read of the canvas: at this size the difference is imperceptible and
// reading pixels back on every mousemove is not.

function hitPet (x, y) {
  const height = window.innerHeight
  const width = window.innerWidth
  for (const p of pets) {
    const petHeight = height * settings.scale * p.stage.appearance.size
    const px = p.stage.position * width
    const feet = height * 0.98
    if (x >= px - petHeight / 2 && x <= px + petHeight / 2 &&
        y >= feet - petHeight && y <= feet) {
      return p
    }
  }
  return null
}

let holding = null
let holdTimer = null
let dragged = false

window.addEventListener('mousemove', e => {
  lastActivity = performance.now()

  if (holding) {
    if (Math.abs(e.clientX - holding.grabX) > 6) {
      dragged = true
      clearTimeout(holdTimer)
      const fraction = e.clientX / window.innerWidth
      holding.pet.stage.position = Math.min(0.96, Math.max(0.04, fraction))
      holding.pet.stage.moveTo(holding.pet.stage.position)
    }
    return
  }

  const over = Boolean(hitPet(e.clientX, e.clientY))
  if (over !== interactive) {
    interactive = over
    window.still.setInteractive(over)
  }
})

window.addEventListener('mousedown', e => {
  const pet = hitPet(e.clientX, e.clientY)
  if (!pet) return
  holding = { pet, grabX: e.clientX }
  dragged = false
  holdTimer = setTimeout(() => { if (holding) holding.pet.stage.pet(true) }, 380)
})

window.addEventListener('mouseup', () => {
  if (!holding) return
  clearTimeout(holdTimer)
  holding.pet.stage.pet(false)
  if (!dragged) holding.pet.stage.poke()
  holding = null
})

// ---- the loop
//
// Frame rate follows activity. A desktop toy that keeps a core busy gets
// uninstalled, so when nothing has happened for a few seconds this drops to a
// third of the rate — the pets keep breathing either way.

let last = performance.now()
let accumulated = 0

function frame (now) {
  const dt = Math.min(0.08, (now - last) / 1000)
  last = now
  const idle = now - lastActivity > 4000 && !holding
  const fps = idle ? settings.idleFps : settings.activeFps
  accumulated += dt

  if (accumulated >= 1 / fps) {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
    for (const p of pets) {
      p.stage.draw(ctx, {
        width: window.innerWidth,
        height: window.innerHeight,
        floor: 0.98,
        scale: settings.scale,
        shadow: true,
      }, accumulated)
    }
    accumulated = 0
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
