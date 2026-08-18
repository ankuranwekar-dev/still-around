// The desktop overlay's renderer — engine3, same numbers as the website.
//
// The window covers the work area and is click-through except on the animal.
// LOD drops when the app is unfocused; we pause entirely if the OS says the
// battery is being saved.

import * as THREE from 'three/webgpu'
import { createStage3 } from '../../../engine3/stage.js'
import { attachLoop } from '../../../engine3/runtime.js'

const canvas = document.getElementById('stage')

let pets = []
let loop = null
let settings = { activeFps: 30, idleFps: 8, scale: 0.14, speech: true }
let interactive = false
let lastActivity = 0
let paused = false

async function load (payload) {
  settings = { ...settings, ...(payload.settings || {}) }
  const wanted = payload.pets || []
  if (loop) { loop.stop(); loop = null }
  pets = []
  for (const [index, pet] of wanted.entries()) {
    const stage = createStage3(THREE, { appearance: pet.appearance, lod: 0 })
    stage.position = 0.28 + index * 0.2
    pets.push({ id: pet.id, name: pet.name, stage })
  }
  loop = await attachLoop(THREE, canvas, pets.map(p => p.stage), {
    alpha: true,
    forceWebGL: true,
    lod: 0,
    spread: 1.8,
  })
  window.still.log(`${pets.length} pet(s) on engine3`)
}

window.still.onPets(load)
window.still.onWelcome(({ name }) => {
  const pet = pets.find(p => p.name === name) || pets[pets.length - 1]
  pet?.stage.say('hello')
})
window.still.getPets().then(load)

function hitPet (x, y) {
  const height = window.innerHeight
  const width = window.innerWidth
  for (const p of pets) {
    const petHeight = height * settings.scale * (p.stage.appearance.size || 1)
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
  holdTimer = setTimeout(() => { if (holding) holding.pet.stage.petting(true) }, 380)
})

window.addEventListener('mouseup', () => {
  if (!holding) return
  clearTimeout(holdTimer)
  holding.pet.stage.petting(false)
  if (!dragged) holding.pet.stage.poke()
  holding = null
})

document.addEventListener('visibilitychange', () => {
  loop?.setFocused(document.visibilityState === 'visible')
})
window.addEventListener('blur', () => loop?.setFocused(false))
window.addEventListener('focus', () => loop?.setFocused(true))

if (navigator.getBattery) {
  navigator.getBattery().then(b => {
    const apply = () => {
      paused = b.charging === false && b.level < 0.15
      if (loop) loop.setFocused(!paused && document.visibilityState === 'visible')
    }
    b.addEventListener('levelchange', apply)
    b.addEventListener('chargingchange', apply)
    apply()
  }).catch(() => {})
}
