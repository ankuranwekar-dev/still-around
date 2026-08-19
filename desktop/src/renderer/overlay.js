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
const SCALE = 0.7

let pets = []
let settings = { scale: 0.14, speech: true }
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

function frame (now) {
  if (!running) return
  if (focused && !batterySaving) {
    const dt = Math.min(0.05, (now - last) / 1000)
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
    for (const pet of pets) {
      pet.stage.draw(ctx, { width: window.innerWidth, height: window.innerHeight, floor: FLOOR, scale: SCALE }, dt)
    }
  }
  last = now
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

function hitPet (x, y) {
  const height = window.innerHeight
  const width = window.innerWidth
  for (const p of pets) {
    const petHeight = height * SCALE * (p.stage.appearance.size || 1)
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
