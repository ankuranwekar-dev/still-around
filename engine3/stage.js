// Behaviour layer for the 3D pet. Weights are the 2D findings: a pet that
// constantly performs is exhausting. Idle stillness is a feature.

import { named, PREWARM } from '../engine/poses.js'
import { createPet } from './pet.js'

const SPEECH = [
  'meow', 'mrrp?', 'feed me', 'food. food.', 'I am hungry',
  'sleepy', 'pet me', 'purr', 'where were you?', 'hello',
]
const DOG_SPEECH = [
  'woof', 'boof', 'walk?', 'hello hello hello', 'treat?',
  'good human', 'I missed you', 'ball?', 'sniff', 'zzz',
]

const IDLE_CHOICES = [
  { clip: 'sit', weight: 26 },
  { clip: 'blink', weight: 14 },
  { clip: 'lookAround', weight: 9 },
  { clip: 'walk', weight: 16 },
  { clip: 'groom', weight: 8 },
  { clip: 'loaf', weight: 8 },
  { clip: 'sleep', weight: 7 },
  { clip: 'stretch', weight: 5 },
  { clip: 'slowBlink', weight: 4 },
  { clip: 'trot', weight: 3 },
]

function pick (choices, random) {
  const total = choices.reduce((s, c) => s + c.weight, 0)
  let r = random() * total
  for (const c of choices) {
    r -= c.weight
    if (r <= 0) return c.clip
  }
  return choices[0].clip
}

export function createStage3 (THREE, { appearance, lod = 0, random = Math.random } = {}) {
  let pet = createPet(THREE, appearance, { lod })
  let x = 0.5
  let target = 0.5
  let bubble = null
  let held = false
  let clipEnd = 0

  function play (name, { dir } = {}) {
    const clip = named(name)
    const facing = dir ?? (target >= x ? 1 : -1)
    pet.play(name, clip.speed > 0 ? facing : pet.root.rotation.y > 1 ? -1 : 1)
    clipEnd = clip.loops ? 3.2 : clip.duration
  }

  function chooseNext () {
    const name = pick(IDLE_CHOICES, random)
    const clip = named(name)
    if (clip.speed > 0) {
      target = 0.12 + random() * 0.76
      play(name, { dir: target > x ? 1 : -1 })
    } else play(name)
    if (random() < 0.18) say((appearance.species === 'dog' ? DOG_SPEECH : SPEECH)[Math.floor(random() * 10)])
  }

  function say (text) { bubble = { text, life: 2.6 } }

  play('sit')

  return {
    root: pet.root,
    pet,
    ensure (names = PREWARM) { return Promise.resolve(names) },
    play,
    say,
    speak () {
      const lines = appearance.species === 'dog' ? DOG_SPEECH : SPEECH
      say(lines[Math.floor(random() * lines.length)])
      play('speak')
    },
    poke () {
      if (random() < 0.45) { play('slowBlink'); say(appearance.species === 'dog' ? 'hello!' : 'mrrp?') }
      else {
        const lines = appearance.species === 'dog' ? DOG_SPEECH : SPEECH
        say(lines[Math.floor(random() * lines.length)])
        play('speak')
      }
    },
    petting (on) {
      held = on
      if (on) { play('purr'); say(appearance.species === 'dog' ? 'good human' : 'purrrr') }
      else chooseNext()
    },
    moveTo (fraction) { target = Math.min(0.94, Math.max(0.06, fraction)) },
    get position () { return x },
    set position (v) { x = v },
    get appearance () { return appearance },
    get bubble () { return bubble },
    update (next) {
      appearance = next
      const parent = this.root.parent
      parent?.remove(this.root)
      pet.dispose()
      pet = createPet(THREE, appearance, { lod: 1 })
      this.root = pet.root
      this.pet = pet
      parent?.add(this.root)
      play('sit')
    },
    tick (dt, { width = 1, floorY = 0 } = {}) {
      if (clipEnd <= 0) chooseNext()
      clipEnd -= dt
      const clip = named(pet.clip)
      if (!held && clip.speed > 0) {
        const step = (clip.speed / 400) * dt
        if (Math.abs(target - x) <= step) x = target
        else x += Math.sign(target - x) * step
        if (Math.abs(target - x) < 0.02 && clip.speed > 0) clipEnd = 0
      }
      pet.root.position.set((x - 0.5) * Math.max(width, 0.4), floorY, 0)
      pet.tick(dt)
      if (bubble) {
        bubble.life -= dt
        if (bubble.life <= 0) bubble = null
      }
      return { x, clip: pet.clip }
    },
    setLod (lod) { pet.setLod(lod) },
    dispose () { pet.dispose() },
  }
}

export { IDLE_CHOICES }
