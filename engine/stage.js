// A pet that lives on a canvas: renders its frames, decides what to do next, and
// wanders about. Shared by the website and the desktop apps so the animal behaves
// the same in both places.
//
// The frame cache is the important part. Every frame is drawn from numbers, which
// costs about ten milliseconds — fine once, far too slow sixty times a second. So
// clips are rendered on demand, cached against the appearance's fingerprint, and
// the pet starts moving as soon as its first clip exists rather than waiting for
// the whole library.

import { renderClip } from './index.js'
import { named, PREWARM } from './poses.js'
import { fingerprint } from './appearance.js'

const SPEECH = [
  'meow', 'mrrp?', 'feed me', 'food. food.', 'I am hungry',
  'sleepy', 'pet me', 'purr', 'where were you?', 'hello',
]
const DOG_SPEECH = [
  'woof', 'boof', 'walk?', 'hello hello hello', 'treat?',
  'good human', 'I missed you', 'ball?', 'sniff', 'zzz',
]

/// What the pet might do when it is left to its own devices, and how likely each
/// is. Resting is weighted heavily — a pet that constantly performs is exhausting
/// to have on screen, and the stillness is most of what makes it feel real.
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

function blitPixels (ctx, frame, x, y, size) {
  const tmp = new OffscreenCanvas(frame.size, frame.size)
  tmp.getContext('2d').putImageData(new ImageData(frame.rgba, frame.size, frame.size), 0, 0)
  ctx.drawImage(tmp, x, y, size, size)
}

export function createStage ({ appearance, quality = 0.55, random = Math.random }) {
  let coatKey = fingerprint(appearance) + ':' + quality
  const cache = new Map()

  let current = null
  let clipTime = 0
  let facing = 1
  let x = 0.5 // 0..1 across the stage
  let target = 0.5
  let bubble = null
  let held = false

  function clipKey (name, dir) { return `${coatKey}|${name}|${dir}` }

  /// Renders a clip if it is not already cached. Synchronous and not cheap: call
  /// it from `ensure` rather than from the draw loop.
  function build (name, dir) {
    const key = clipKey(name, dir)
    if (cache.has(key)) return cache.get(key)
    const clip = renderClip(appearance, name, { facing: dir, quality })
    // Frames become ImageBitmaps where available so drawing is a GPU blit; the
    // fallback keeps raw pixels, which still draws, just more slowly.
    const entry = { ...clip, bitmaps: null, pending: null }
    cache.set(key, entry)
    if (typeof createImageBitmap === 'function') {
      entry.pending = Promise.all(
        clip.frames.map(f => createImageBitmap(new ImageData(f.rgba, f.size, f.size)))
      ).then(bitmaps => { entry.bitmaps = bitmaps; entry.pending = null })
    }
    return entry
  }

  async function ensure (names = PREWARM, onProgress = null) {
    let done = 0
    for (const name of names) {
      for (const dir of named(name).speed > 0 ? [1, -1] : [1]) {
        const entry = build(name, dir)
        if (entry.pending) await entry.pending
      }
      done++
      if (onProgress) onProgress(done, names.length)
      // Yield so a browser stays responsive while the library fills in.
      await new Promise(r => setTimeout(r, 0))
    }
  }

  function play (name, { dir = facing } = {}) {
    const entry = build(name, dir)
    current = { name, entry, dir }
    clipTime = 0
    facing = dir
    return entry
  }

  function say (text) {
    bubble = { text, life: 2.6 }
  }

  function speak () {
    const lines = appearance.species === 'dog' ? DOG_SPEECH : SPEECH
    say(lines[Math.floor(random() * lines.length)])
    play('speak')
  }

  function chooseNext () {
    const name = pick(IDLE_CHOICES, random)
    const clip = named(name)
    if (clip.speed > 0) {
      // Pick somewhere to go, and turn to face it. Corners are avoided so the pet
      // never walks off the edge and has to teleport back.
      target = 0.12 + random() * 0.76
      play(name, { dir: target > x ? 1 : -1 })
    } else {
      play(name)
    }
    if (random() < 0.18) say((appearance.species === 'dog' ? DOG_SPEECH : SPEECH)[Math.floor(random() * 10)])
  }

  /// Advance by `dt` seconds and draw into a 2D context.
  ///
  /// `floor` is where the pet's feet sit, as a fraction of height. `scale` is how
  /// tall the pet is relative to the canvas height.
  function draw (ctx, { width, height, floor = 0.92, scale = 0.68, shadow = true } = {}, dt = 1 / 60) {
    if (!current) chooseNext()
    const clip = current.entry

    clipTime += dt
    const frameCount = clip.frames.length
    const index = Math.floor(clipTime * clip.fps)

    if (index >= frameCount) {
      if (clip.loops && clipTime < 3.2) {
        // Loop for a while, then decide again, so a walk does not go on forever.
      } else {
        chooseNext()
        return draw(ctx, { width, height, floor, scale, shadow }, 0)
      }
    }

    if (!held && clip.speed > 0) {
      const step = (clip.speed / Math.max(1, width)) * dt
      if (Math.abs(target - x) <= step) x = target
      else x += Math.sign(target - x) * step
    }

    const f = clip.frames[index % frameCount]
    if (!f) return { x, clip: current.name }
    // Scaled by the pet's own size, not just the stage's. A bigger animal gets a
    // bigger sprite grid too, but that is only resolution — without this, two
    // pets of different sizes drew to identical heights and Momo came out the
    // same size as Belle despite being a quarter bigger.
    const petHeight = height * scale * appearance.size
    const px = x * width
    const py = height * floor

    if (shadow) {
      const w = petHeight * 0.34
      ctx.save()
      ctx.globalAlpha = 0.16
      ctx.fillStyle = '#2b2118'
      ctx.beginPath()
      ctx.ellipse(px, py - petHeight * 0.02, w, w * 0.19, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // The rig authors its floor at y = 58 of 64, so the sprite is nudged down by
    // the remaining sliver to put the feet on the ground rather than the frame.
    const drawY = py - petHeight + petHeight * (6 / 64)
    const dx = px - petHeight / 2
    const bitmap = clip.bitmaps ? clip.bitmaps[index % frameCount] : null
    try {
      if (bitmap) ctx.drawImage(bitmap, dx, drawY, petHeight, petHeight)
      else blitPixels(ctx, f, dx, drawY, petHeight)
    } catch {
      blitPixels(ctx, f, dx, drawY, petHeight)
    }

    if (bubble) {
      bubble.life -= dt
      if (bubble.life <= 0) bubble = null
      else drawBubble(ctx, bubble, px, drawY, petHeight)
    }

    return { x, clip: current.name }
  }

  function drawBubble (ctx, b, px, topY, petHeight) {
    const fade = Math.min(1, b.life / 0.4)
    const pad = Math.max(7, petHeight * 0.045)
    ctx.save()
    ctx.globalAlpha = fade
    ctx.font = `${Math.max(11, Math.round(petHeight * 0.085))}px ui-rounded, "Segoe UI", system-ui, sans-serif`
    const w = ctx.measureText(b.text).width + pad * 2
    const h = Math.max(20, petHeight * 0.15)
    const bx = Math.min(Math.max(px - w / 2, 4), ctx.canvas.width / (ctx.canvas.width / ctx.canvas.clientWidth || 1) - w - 4)
    const by = topY - h - 6

    ctx.fillStyle = 'rgba(255,253,247,0.96)'
    ctx.strokeStyle = 'rgba(60,48,36,0.16)'
    ctx.lineWidth = 1
    const r = h / 2
    ctx.beginPath()
    ctx.moveTo(bx + r, by)
    ctx.arcTo(bx + w, by, bx + w, by + h, r)
    ctx.arcTo(bx + w, by + h, bx, by + h, r)
    ctx.arcTo(bx, by + h, bx, by, r)
    ctx.arcTo(bx, by, bx + w, by, r)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // The little tail on the bubble, pointing at the animal.
    ctx.beginPath()
    ctx.moveTo(px - 5, by + h - 1)
    ctx.lineTo(px + 2, by + h + 7)
    ctx.lineTo(px + 6, by + h - 1)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255,253,247,0.96)'
    ctx.fill()

    ctx.fillStyle = '#3a2f26'
    ctx.textBaseline = 'middle'
    ctx.fillText(b.text, bx + pad, by + h / 2 + 0.5)
    ctx.restore()
  }

  return {
    ensure,
    play,
    draw,
    say,
    speak,
    /// Someone clicked the pet.
    poke () {
      if (random() < 0.45) { play('slowBlink'); say(appearance.species === 'dog' ? 'hello!' : 'mrrp?') }
      else speak()
    },
    /// Someone is holding the pointer down on it.
    pet (on) {
      held = on
      if (on) { play('purr'); say(appearance.species === 'dog' ? 'good human' : 'purrrr') }
      else chooseNext()
    },
    moveTo (fraction) { target = Math.min(0.94, Math.max(0.06, fraction)) },
    get position () { return x },
    set position (v) { x = v },
    /// Swap in a new look without throwing away the whole cache when only the
    /// colours changed — a slider drag would otherwise re-render everything.
    update (next) {
      appearance = next
      const key = fingerprint(next) + ':' + quality
      if (key !== coatKey) { coatKey = key; cache.clear(); current = null }
    },
    get appearance () { return appearance },
  }
}
