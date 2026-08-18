// A cat and a dog, drawn live — the interactive persona demo.
//
// Ported from a design prototype rather than written from scratch: the
// prototype's engineering was worth keeping verbatim (a worker so rendering
// never stalls the page, resolution chosen from the animal's actual on-screen
// size rather than a fixed constant, each frame cropped to its own bounding
// box before caching so a dozen clips don't need a dozen full canvases of
// memory), only the authoring framework underneath it — refs, JSX-ish
// bindings, a props panel — doesn't exist outside that tool and is replaced
// here with plain DOM lookups and hardcoded defaults.

import { fromHex } from '../engine/appearance.js'

const PET_SCALE = 0.78
const FLOOR = 0.92
const GRID_CAP = 620

// The props panel's own defaults, now just constants: how finely a clip is
// sampled in time (SMOOTHNESS) and in device pixels (SHARPNESS), whether an
// animal is allowed to wander the stage or only performs in place, and whether
// it casts a ground shadow.
const SHARPNESS = 1.5
const SMOOTHNESS = 1.6
const IDLE_WANDER = true
const GROUND_SHADOW = true

// How likely each behaviour is when the animal is left alone. Resting is
// weighted heavily: a pet that constantly performs is exhausting to watch, and
// the stillness is most of what makes it read as real.
const IDLE = [
  { clip: 'sit', w: 26 }, { clip: 'blink', w: 14 }, { clip: 'slowBlink', w: 5 },
  { clip: 'walk', w: 15 }, { clip: 'groom', w: 8 }, { clip: 'trot', w: 6 },
  { clip: 'sleep', w: 8 }, { clip: 'speak', w: 4 },
]

// Frames rendered per clip, chosen so every clip plays at roughly twenty a
// second rather than the six to twelve the pose library declares. This is the
// other half of the smoothness: finer sampling of the same motion.
const COUNTS = {
  sit: 40, blink: 10, slowBlink: 24, walk: 22, trot: 14, speak: 18,
  groom: 30, sleep: 40, loaf: 34, stretch: 30, purr: 12, attend: 30,
  lookAround: 40, knead: 22, startle: 12, pounce: 20, wake: 22,
}

const CAT_LINES = ['meow', 'mrrp?', 'feed me', 'sleepy', 'pet me', 'purr', 'where were you?', 'hello']
const DOG_LINES = ['woof', 'boof', 'walk?', 'treat?', 'good human', 'I missed you', 'ball?', 'hello hello hello']

/// The whole definition of an animal: about thirty numbers, the same shape of
/// object the analyzer produces and the pet file carries.
function appearanceFor (kind) {
  if (kind === 'dog') {
    return {
      species: 'dog', size: 1.16, build: 0.24, earStyle: 'floppy', snout: 0.66,
      tailStyle: 'long', furLength: 0.24, earNotch: 0, earNotchOnLeft: true,
      pattern: 'solid', base: fromHex(0xc4894c), accent: fromHex(0x8b5a2b),
      eye: fromHex(0x6b4a2e), nose: fromHex(0x3a322c),
      capCoverage: 0.9, faceBlaze: 0.16, faceMask: 0, saddle: 0.92,
      chestWhite: 0.3, socks: 0.22, tailBands: 0, patternContrast: 0.05,
      patchiness: 0, collar: null,
    }
  }
  return {
    species: 'cat', size: 1.0, build: 0.05, earStyle: 'pointed', snout: 0.34,
    tailStyle: 'long', furLength: 0.3, earNotch: 0, earNotchOnLeft: true,
    pattern: 'tabby', base: fromHex(0xc98b4e), accent: fromHex(0x8d5726),
    eye: fromHex(0xa8b46a), nose: fromHex(0xe3a19b),
    capCoverage: 0.82, faceBlaze: 0.3, faceMask: 0, saddle: 0.8,
    chestWhite: 0.42, socks: 0.35, tailBands: 0.55, patternContrast: 0.6,
    patchiness: 0, collar: null,
  }
}

function countFor (name) {
  return Math.max(6, Math.round((COUNTS[name] || 22) * SMOOTHNESS))
}

/// Render order. `sit` is asked for twice on purpose: a coarse pass in time
/// (full resolution, few frames) puts a crisp animal on the stage in under a
/// second, and the finer pass replaces it a moment later.
function plan (kind) {
  const names = kind === 'dog'
    ? ['sit', 'blink', 'walk', 'speak', 'trot', 'sleep']
    : ['sit', 'blink', 'walk', 'speak', 'groom', 'sleep']
  const jobs = [{ clip: 'sit', count: 10 }]
  for (const n of names) jobs.push({ clip: n, count: countFor(n) })
  return jobs
}

/// Trim a rendered frame down to its own opaque bounding box. Only used as the
/// no-worker fallback here — the worker does the same crop on its own thread —
/// so a browser that refuses module workers still gets a working, if slower,
/// animal rather than a blank stage.
function crop (rgba, size) {
  let x0 = size, y0 = size, x1 = -1, y1 = -1
  for (let y = 0; y < size; y++) {
    const row = y * size
    for (let x = 0; x < size; x++) {
      if (rgba[(row + x) * 4 + 3] > 2) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const from = ((y + y0) * size + x0) * 4
    out.set(rgba.subarray(from, from + w * 4), y * w * 4)
  }
  return { image: new ImageData(out, w, h), box: { x: x0, y: y0, w, h } }
}

class PersonaStage {
  constructor (kind) {
    this.kind = kind
    this.canvas = document.getElementById(`${kind}-canvas`)
    this.ctx = this.canvas.getContext('2d')
    this.bubbleEl = document.getElementById(`${kind}-bubble`)
    this.barEl = document.getElementById(`${kind}-bar`)
    this.appearance = appearanceFor(kind)
    this.lib = new Map()
    this.queue = plan(kind)
    this.busy = null
    this.jobId = 0
    this.clip = null
    this.t = 0
    this.loopT = 0
    this.x = 0.5
    this.target = 0.5
    this.dir = kind === 'dog' ? -1 : 1
    this.fade = null
    this.bubble = null
    this.pending = null
    this.quality = 1
    this.dpr = 1
    this.cur = null
    this.engine = null

    this.worker = this.spawn()
    this.measure()
    this.pump()
  }

  spawn () {
    try {
      const w = new Worker('./pet-worker.js', { type: 'module' })
      w.onmessage = ev => this.onMessage(ev.data)
      w.onerror = () => {
        // No worker available: fall back to rendering on the main thread in
        // small slices. Slower and slightly janky, but the pet still appears.
        if (this.worker) { this.worker.terminate(); this.worker = null }
        if (this.busy) this.local(this.busy)
      }
      return w
    } catch {
      return null
    }
  }

  /// The one decision that removes pixelation: the sprite grid is sized from
  /// the device pixels the animal will actually occupy, not from a fixed
  /// constant.
  measure () {
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.dpr = dpr
    const a = this.appearance
    const base = a.species === 'dog' ? 272 : 256
    const span = base * (0.82 + 0.36 * a.size)
    const petPx = h * PET_SCALE * a.size * SHARPNESS
    this.quality = Math.max(0.45, Math.min(GRID_CAP / span, petPx / span))
  }

  remeasure (force) {
    const before = this.quality
    this.measure()
    if (!force && this.quality <= before * 1.1) return
    const have = Array.from(this.lib.keys()).map(n => ({ clip: n, count: countFor(n) }))
    const queued = this.queue.filter(j => !this.lib.has(j.clip))
    this.queue = have.concat(queued)
    this.pump()
  }

  // MARK: - Frame supply

  pump () {
    if (this.busy) return
    if (!this.queue.length) {
      if (this.barEl) { this.barEl.style.width = '0'; this.barEl.style.opacity = '0' }
      return
    }
    const job = this.queue.shift()
    this.busy = {
      type: 'job', id: ++this.jobId, kind: this.kind, clip: job.clip,
      count: job.count, quality: this.quality, appearance: this.appearance,
    }
    if (this.barEl) this.barEl.style.opacity = '0.5'
    if (this.worker) this.worker.postMessage(this.busy)
    else this.local(this.busy)
  }

  request (name) {
    if (this.lib.has(name)) return
    if (this.busy && this.busy.clip === name) return
    this.queue = this.queue.filter(j => j.clip !== name)
    this.queue.unshift({ clip: name, count: countFor(name) })
    this.pump()
  }

  onMessage (m) {
    if (!m) return
    if (m.type === 'progress') {
      if (this.barEl) this.barEl.style.width = Math.round((m.done / m.total) * 100) + '%'
      return
    }
    if (m.type !== 'clip') return

    const entry = {
      clip: m.clip, count: m.count, size: m.size, duration: m.duration,
      loops: m.loops, speed: m.speed, quality: m.quality, view: m.view,
      bitmaps: m.bitmaps, boxes: m.boxes,
      fps: m.count / Math.max(0.001, m.duration),
      used: performance.now(),
    }
    const prev = this.lib.get(m.clip)
    const better = !prev || m.quality > prev.quality * 1.02 ||
      (m.quality >= prev.quality * 0.98 && m.count > prev.count)
    if (better) {
      if (prev) this.release(prev)
      this.lib.set(m.clip, entry)
      // Swapping the sharper copy in under a playing clip keeps the phase, so
      // the refinement is invisible rather than a jump.
      if (this.clip === m.clip && this.t > entry.duration) this.t = this.t % entry.duration
    } else {
      this.release(entry)
    }
    if (this.busy && this.busy.id === m.id) this.busy = null
    if (this.barEl) this.barEl.style.width = '0'
    if (this.pending === m.clip) { this.pending = null; this.play(m.clip) }
    else if (!this.clip) this.chooseNext()
    this.trim()
    this.pump()
    // Paint once here as well as from the animation loop: a page in a
    // background tab gets no animation frames at all, and an animal that only
    // appears once the tab is focused looks like a bug.
    this.step(0, 0)
  }

  release (entry) {
    if (!entry || !entry.bitmaps) return
    for (const b of entry.bitmaps) if (b && b.close) b.close()
    entry.bitmaps = null
  }

  /// A full-resolution library is expensive in memory, so only a working set is
  /// kept; the least recently played clip goes first and is re-rendered if the
  /// animal wants it again.
  trim () {
    const cap = 7
    while (this.lib.size > cap) {
      let oldest = null
      for (const [name, e] of this.lib) {
        if (name === this.clip) continue
        if (!oldest || e.used < oldest[1].used) oldest = [name, e]
      }
      if (!oldest) break
      this.release(oldest[1])
      this.lib.delete(oldest[0])
    }
  }

  // MARK: - Main-thread fallback

  async local (job) {
    if (!this.engine) this.engine = Promise.all([import('../engine/index.js'), import('../engine/poses.js')])
    const [eng, poses] = await this.engine
    const clip = poses.named(job.clip)
    const bitmaps = []
    const boxes = []
    let size = 0
    for (let i = 0; i < job.count; i++) {
      const f = eng.renderFrame(job.appearance, {
        animation: job.clip, frame: (i / job.count) * clip.frames, quality: job.quality,
      })
      size = f.size
      const c = crop(f.rgba, f.size)
      bitmaps.push(c ? await createImageBitmap(c.image) : null)
      boxes.push(c ? c.box : null)
      if ((i & 3) === 3) this.onMessage({ type: 'progress', id: job.id, done: i + 1, total: job.count })
      await new Promise(r => setTimeout(r, 0))
    }
    this.onMessage({
      type: 'clip', id: job.id, kind: this.kind, clip: job.clip, quality: job.quality,
      count: job.count, size, duration: clip.frames / clip.fps, loops: clip.loops,
      speed: clip.speed, view: clip.pose(0).view, boxes, bitmaps,
    })
  }

  // MARK: - Behaviour

  lines () { return this.appearance.species === 'dog' ? DOG_LINES : CAT_LINES }

  say (text) {
    this.bubble = { text, life: 2.6 }
  }

  play (name, dir) {
    const e = this.lib.get(name)
    if (!e) { this.pending = name; this.request(name); return }
    // Dissolve only between clips drawn from the same viewpoint. Sitting
    // face-on fading into a curled-up side view is a double exposure, not a
    // transition, so those cut.
    const from = this.clip ? this.lib.get(this.clip) : null
    if (this.cur && this.cur.bitmap && from && from.view === e.view) {
      this.fade = Object.assign({}, this.cur, { alpha: 1 })
    } else {
      this.fade = null
    }
    this.clip = name
    this.t = 0
    this.loopT = 0
    e.used = performance.now()
    if (dir) this.dir = dir
  }

  chooseNext () {
    let ready = IDLE.filter(c => this.lib.has(c.clip))
    if (!IDLE_WANDER) ready = ready.filter(c => this.lib.get(c.clip).speed === 0)
    if (!ready.length) { this.t = 0; return }
    let total = 0
    for (const c of ready) total += c.w
    let r = Math.random() * total
    let name = ready[0].clip
    for (const c of ready) { r -= c.w; if (r <= 0) { name = c.clip; break } }
    const e = this.lib.get(name)
    let dir = this.dir
    if (e.speed > 0) {
      // Somewhere to go, and a turn to face it. Corners are avoided so the
      // animal never has to teleport back from an edge.
      this.target = 0.16 + Math.random() * 0.68
      dir = this.target > this.x ? 1 : -1
    }
    this.play(name, dir)
    if (Math.random() < 0.15) this.say(this.lines()[Math.floor(Math.random() * this.lines().length)])
  }

  cue (name) {
    if (name === 'speak') this.say(this.lines()[Math.floor(Math.random() * this.lines().length)])
    this.play(name)
  }

  poke () {
    if (Math.random() < 0.42) {
      this.say(this.appearance.species === 'dog' ? 'hello!' : 'mrrp?')
      this.play('slowBlink')
    } else {
      this.say(this.lines()[Math.floor(Math.random() * this.lines().length)])
      this.play('speak')
    }
  }

  // MARK: - Drawing

  step (dt, depth) {
    const ctx = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height
    if (depth === 0) ctx.clearRect(0, 0, W, H)

    if (!this.clip) { this.chooseNext(); if (!this.clip) { this.bubbleTo(dt, null); return } }
    const e = this.lib.get(this.clip)
    if (!e || !e.bitmaps) { this.clip = null; return }

    this.t += dt
    if (this.t >= e.duration) {
      if (e.loops && this.loopT + e.duration < 3.8) { this.loopT += e.duration; this.t -= e.duration }
      else if (depth < 2) { this.chooseNext(); return this.step(0, depth + 1) }
      else { this.t = this.t % e.duration }
    }

    if (e.speed > 0 && IDLE_WANDER) {
      const stride = (e.speed / Math.max(1, W / this.dpr)) * dt
      if (Math.abs(this.target - this.x) <= stride) this.x = this.target
      else this.x += (this.target > this.x ? 1 : -1) * stride
    } else if (!IDLE_WANDER) {
      this.x += (0.5 - this.x) * Math.min(1, dt * 2.6)
    }

    const petH = H * PET_SCALE * this.appearance.size
    const px = this.x * W
    const floorY = H * FLOOR
    if (GROUND_SHADOW) this.shadow(ctx, px, floorY, petH)

    const idx = Math.min(e.count - 1, Math.max(0, Math.floor(this.t * e.fps)))
    this.cur = { bitmap: e.bitmaps[idx], box: e.boxes[idx], size: e.size, x: px, dir: this.dir, petH, floorY }
    this.blit(ctx, this.cur, 1)

    // A short dissolve out of the previous clip, so a change of behaviour is a
    // transition rather than a pop.
    if (this.fade) {
      this.fade.alpha -= dt / 0.2
      if (this.fade.alpha <= 0) this.fade = null
      else this.blit(ctx, this.fade, this.fade.alpha)
    }

    this.bubbleTo(dt, { px, top: floorY - petH })
  }

  blit (ctx, f, alpha) {
    if (!f || !f.bitmap || !f.box) return
    const S = f.petH
    const k = S / f.size
    const left = f.x - S / 2
    // The rig authors its floor at y = 58 of 64, so the sprite is nudged down
    // by the remaining sliver to stand the feet on the ground and not on the
    // frame.
    const top = f.floorY - S + S * (6 / 64)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    if (f.dir < 0) { ctx.translate(f.x * 2, 0); ctx.scale(-1, 1) }
    ctx.drawImage(f.bitmap, left + f.box.x * k, top + f.box.y * k, f.box.w * k, f.box.h * k)
    ctx.restore()
  }

  shadow (ctx, px, floorY, petH) {
    const rx = petH * 0.34
    const ry = rx * 0.2
    const g = ctx.createRadialGradient(px, floorY, 0, px, floorY, rx)
    g.addColorStop(0, 'rgba(84,62,40,0.22)')
    g.addColorStop(0.62, 'rgba(84,62,40,0.10)')
    g.addColorStop(1, 'rgba(84,62,40,0)')
    ctx.save()
    ctx.translate(px, floorY - petH * 0.015)
    ctx.scale(1, ry / rx)
    ctx.translate(-px, -(floorY - petH * 0.015))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(px, floorY - petH * 0.015, rx, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /// The speech bubble is HTML, not canvas: text stays crisp at any zoom and
  /// the browser does the type.
  bubbleTo (dt, at) {
    const el = this.bubbleEl
    if (!el) return
    if (!this.bubble) { el.style.opacity = '0'; return }
    this.bubble.life -= dt
    if (this.bubble.life <= 0 || !at) { this.bubble = null; el.style.opacity = '0'; return }
    el.textContent = this.bubble.text
    el.style.left = (at.px / this.dpr) + 'px'
    el.style.top = Math.max(24, at.top / this.dpr - 10) + 'px'
    el.style.opacity = String(Math.min(1, this.bubble.life / 0.45))
  }

  destroy () {
    if (this.worker) this.worker.terminate()
    for (const e of this.lib.values()) this.release(e)
  }
}

// ---------------------------------------------------------------- wire it up

const stages = { cat: new PersonaStage('cat'), dog: new PersonaStage('dog') }

document.getElementById('cat-stage').addEventListener('click', () => stages.cat.poke())
document.getElementById('dog-stage').addEventListener('click', () => stages.dog.poke())

const BUTTONS = {
  'cat-sit': ['cat', 'sit'], 'cat-blink': ['cat', 'slowBlink'], 'cat-walk': ['cat', 'walk'],
  'cat-groom': ['cat', 'groom'], 'cat-nap': ['cat', 'sleep'], 'cat-speak': ['cat', 'speak'],
  'dog-sit': ['dog', 'sit'], 'dog-blink': ['dog', 'slowBlink'], 'dog-walk': ['dog', 'walk'],
  'dog-trot': ['dog', 'trot'], 'dog-nap': ['dog', 'sleep'], 'dog-speak': ['dog', 'speak'],
}
for (const [id, [kind, clip]] of Object.entries(BUTTONS)) {
  document.getElementById(id).addEventListener('click', e => {
    e.stopPropagation() // don't also trigger the stage's own click-to-poke
    stages[kind].cue(clip)
  })
}

// A hidden tab stops firing animation frames on its own, so there is nothing to
// pause; what matters is not carrying a several-second gap into the next frame,
// and not resuming halfway through a dissolve.
let last = 0
document.addEventListener('visibilitychange', () => {
  last = 0
  for (const s of Object.values(stages)) s.fade = null
})

let resizeTimer = null
if (typeof ResizeObserver === 'function') {
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => { for (const s of Object.values(stages)) s.remeasure(true) }, 350)
  })
  for (const s of Object.values(stages)) ro.observe(s.canvas)
}

function tick (now) {
  requestAnimationFrame(tick)
  if (!last) { last = now; return }
  const dt = Math.min(0.06, (now - last) / 1000)
  last = now
  for (const s of Object.values(stages)) s.step(dt, 0)
}
requestAnimationFrame(tick)
