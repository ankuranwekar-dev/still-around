// The desktop overlay's renderer — the same 2D engine as the website, so a pet
// built in a browser looks identical here.
//
// The window covers the work area and is click-through except on the animal.
// Rendering pauses entirely when the app is unfocused or the OS says the
// battery is being saved — an idle desktop toy that costs battery gets
// uninstalled.

import { createStage } from '../../../engine/stage.js'

const canvas = document.getElementById('stage')
const ctx = canvas.getContext('2d')

// Where the pets' feet sit, as a fraction of window height. hitPet below has
// to agree with this, since it is doing the same geometry in reverse.
const FLOOR = 0.97

let pets = []
// scale is pet height as a fraction of window height — the tray's Size menu
// changes it; store.js's DEFAULTS.settings.scale is the fallback before the
// first pets:set arrives.
let settings = { scale: 0.175, speech: true, paused: false, activeFps: 30, idleFps: 8, pauseOnBatterySaver: true }
let interactive = false
let focused = true
let batterySaving = false
let running = true
let last = performance.now()

function fitCanvas () {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.max(1, Math.round(window.innerWidth * dpr))
  canvas.height = Math.max(1, Math.round(window.innerHeight * dpr))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
fitCanvas()
window.addEventListener('resize', fitCanvas)

async function load (payload) {
  settings = { ...settings, ...(payload.settings || {}) }
  const wanted = payload.pets || []
  pets = wanted.map((pet, index) => {
    const stage = createStage({ appearance: pet.appearance, quality: 0.6 })
    stage.position = 0.28 + index * 0.2
    return { id: pet.id, name: pet.name, stage }
  })
  // Enough of the library to appear and move; the rest fills in behind them.
  for (const p of pets) p.stage.speech = settings.speech !== false
  await Promise.all(pets.map(p => p.stage.ensure(['sit', 'blink', 'walk', 'speak'])))
  for (const p of pets) p.stage.play('sit')
  const rest = ['lookAround', 'groom', 'loaf', 'sleep', 'stretch', 'purr', 'slowBlink', 'trot']
  for (const p of pets) p.stage.ensure(rest)
  window.still.log(`${pets.length} pet(s) rendering`)
}

window.still.onPets(load)
window.still.onWelcome(({ name }) => {
  const pet = pets.find(p => p.name === name) || pets[pets.length - 1]
  pet?.stage.say('hello')
})
window.still.getPets().then(load)

/// How smooth this moment needs to be. A desktop pet that renders 60 frames a
/// second at a sleeping cat is a laptop that runs hot for nothing, and the first
/// thing anyone does about that is uninstall it.
function targetFps () {
  if (interactive || holding) return settings.activeFps
  if (pets.some(p => p.stage.busy)) return settings.activeFps
  return Math.max(settings.idleFps, Math.min(15, Math.round(settings.activeFps / 2)))
}

let frameBudget = 0

function frame (now) {
  if (!running) return
  requestAnimationFrame(frame)

  const dt = Math.min(0.05, (now - last) / 1000)
  last = now

  // "Hold still" deliberately does not clear the canvas: they stay exactly where
  // they were, mid-pose, rather than vanishing. Stopping is not the same as
  // hiding, and hiding is already its own switch.
  if (!focused || settings.paused) return
  if (batterySaving && settings.pauseOnBatterySaver !== false) return

  frameBudget += dt
  const target = Math.max(1, targetFps())
  if (frameBudget < 1 / target) return
  const step = frameBudget
  frameBudget = 0

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
  for (const pet of pets) {
    pet.stage.draw(ctx, { width: window.innerWidth, height: window.innerHeight, floor: FLOOR, scale: settings.scale }, step)
  }
}
requestAnimationFrame(frame)

function hitPet (x, y) {
  const height = window.innerHeight
  const width = window.innerWidth
  for (const p of pets) {
    const petHeight = height * settings.scale * (p.stage.appearance.size || 1)
    const px = p.stage.position * width
    const feet = height * FLOOR
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
  last = performance.now()
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

// Right-clicking the animal itself is how the first version of this was driven,
// and it is the obvious gesture: the pet is the only thing on screen, so it should
// be the thing you can talk to. The tray still has everything; this is the short way.
// Double-clicking the animal opens settings, exactly as the first version did.
// It only counts on the pet: a double-click on empty desktop is not aimed at us.
window.addEventListener('dblclick', event => {
  if (!hitPet(event.clientX, event.clientY)) return
  window.still.openSettings()
})

window.addEventListener('contextmenu', event => {
  const pet = hitPet(event.clientX, event.clientY)
  if (!pet) return
  event.preventDefault()
  window.still.contextMenu({ id: pet.id, name: pet.name, at: event.clientX / window.innerWidth })
})

window.still.onCommand(({ id, command, at }) => {
  const pet = pets.find(p => p.id === id)
  if (!pet) return
  switch (command) {
    // Walking over is nicer than teleporting, and moveTo is already the thing
    // that makes them walk — the drag gesture uses it too.
    case 'come': pet.stage.moveTo(typeof at === 'number' ? at : 0.5); break
    case 'speak': pet.stage.speak(); break
    case 'sleep': pet.stage.play('sleep'); break
    case 'stretch': pet.stage.play('stretch'); break
    case 'groom': pet.stage.play('groom'); break
    case 'sit': pet.stage.play('sit'); break
  }
})

document.addEventListener('visibilitychange', () => { focused = document.visibilityState === 'visible' })
window.addEventListener('blur', () => { focused = false })
window.addEventListener('focus', () => { focused = true })

if (navigator.getBattery) {
  navigator.getBattery().then(b => {
    const apply = () => { batterySaving = b.charging === false && b.level < 0.15 }
    b.addEventListener('levelchange', apply)
    b.addEventListener('chargingchange', apply)
    apply()
  }).catch(() => {})
}
