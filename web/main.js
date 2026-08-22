// The website's behaviour: a live pet on the hero, and a studio that turns
// someone's photos into their own.
//
// There is no framework and no build step, because the whole thing has to keep
// working as plain files on a static host for years without anyone maintaining a
// toolchain. The heavy lifting all lives in ../engine and ../analyzer, which the
// desktop apps import unchanged.

import { SITE } from './config.js'
import {
  defaultCat, defaultDog, fromHex, toHex, starting, Species, CoatPattern,
  EarStyle, TailStyle, patternLabels,
} from '../engine/appearance.js'
import { createStage } from '../engine/stage.js'
import { toPetFile } from '../engine3/appearance.js'
import { segment, toSmall, shrinkMask } from '../analyzer/segment.js'
import * as Vision from '../analyzer/vision.js'
import { readFromShots } from '../analyzer/analyze.js'
import { framesFromVideo, frameFromImage } from '../analyzer/frames.js'
import { SHOTS, ESSENTIAL, SLOT_ART, SLOT_PET, shapeOf, scoreShot, assignShots } from '../analyzer/shots.js'
import { scoreCapture } from '../analyzer/quality.js'
import { renderFrame } from '../engine/index.js'

const $ = id => document.getElementById(id)

// The desktop app ships this exact page and opens it as its studio window, so the
// hard part — guided capture, the models, the likeness editor — has one
// implementation rather than two that drift apart. `stillDesktop` is injected by
// that window's preload and is undefined in an ordinary browser tab, which is the
// only difference between the two.
const DESKTOP = Boolean(window.stillDesktop)
if (DESKTOP) document.documentElement.classList.add('in-app')

// ---------------------------------------------------------------- analytics

/// Counting visits without watching people.
///
/// Never inside the desktop app: the app is not a website, nobody expects a
/// program on their machine to phone home, and the studio it opens is this very
/// page. Whatever is true of analytics here must not become true there.
const analyticsMode = DESKTOP ? 'none' : (SITE.analytics?.provider || 'none')

if (analyticsMode === 'vercel') {
  // First-party: served from this domain, so nothing is sent to anyone else.
  const s = document.createElement('script')
  s.defer = true
  s.src = '/_vercel/insights/script.js'
  document.head.appendChild(s)
} else if (analyticsMode === 'plausible' && SITE.analytics?.domain) {
  const s = document.createElement('script')
  s.defer = true
  s.dataset.domain = SITE.analytics.domain
  s.src = SITE.analytics.src
  document.head.appendChild(s)
}

// Said plainly, and kept true. A site whose whole promise is that it does not
// look at your things cannot claim "no analytics" while counting visits — the
// photos never leaving your device is the promise, and it is untouched by this.
const note = $('analytics-note')
if (note) {
  note.textContent = analyticsMode === 'none'
    ? 'No analytics, no cookies, no trackers on this page.'
    : 'We count visits — how many, and which country — with no cookies and nothing that identifies you. Your photos are never part of it.'
}

function track (event) {
  // Vercel's own name for a custom event, and Plausible's, from one call site.
  if (window.va) window.va('event', { name: event })
  if (window.plausible) window.plausible(event)
}

// ---------------------------------------------------------------- downloads

function wireDownload (linkId, noteId, url, label, name) {
  const link = $(linkId)
  const note = $(noteId)
  if (url) {
    link.href = url
    link.addEventListener('click', () => track(`download:${label}`))
    note.textContent = ''
  } else {
    // `disabled` is not a thing on an anchor, so the old version still navigated.
    link.classList.add('is-off')
    link.removeAttribute('href')
    link.setAttribute('aria-disabled', 'true')
    link.textContent = 'Coming soon'
    note.textContent = `The ${name} app is not published yet — make your pet now and it will open the moment it is.`
  }
}
wireDownload('dl-mac', 'dl-mac-note', SITE.downloads.mac, 'mac', 'macOS')
wireDownload('dl-win', 'dl-win-note', SITE.downloads.windows, 'windows', 'Windows')
$('source-link').href = SITE.downloads.source || '#'

if (SITE.donateUrl) {
  // The block under the downloads, and the quiet one in the footer.
  const block = $('support')
  if (block) {
    block.classList.remove('hidden')
    $('support-title').textContent = SITE.donateLabel
    $('support-blurb').textContent = SITE.donateBlurb || ''
    const link = $('support-link')
    link.href = SITE.donateUrl
    link.textContent = SITE.donateLabel
    link.addEventListener('click', () => track('support'))
  }
  $('donate').classList.remove('hidden')
  const d = $('donate-link')
  d.href = SITE.donateUrl
  d.textContent = SITE.donateLabel
  d.target = '_blank'
  d.addEventListener('click', () => track('donate'))
}

// ------------------------------------------------------------- the two cats
// The sample on the hero is the pair this was built for. Their numbers are
// hand-written because they were measured by a person, over a long time, against
// a lot of photographs — which is exactly what the studio is for saving everyone
// else from having to do.

const MOMO = {
  ...defaultCat(),
  pattern: CoatPattern.tabby,
  base: fromHex(0xc9884a),
  accent: fromHex(0x8c5626),
  eye: fromHex(0x9aa863),
  nose: fromHex(0xe6a79c),
  size: 1.25, // Momo was the bigger of the two, by about a quarter
  build: 0.25,
  capCoverage: 0.48,
  faceBlaze: 0.5,
  saddle: 0.62,
  chestWhite: 0.9,
  socks: 0.95,
  tailBands: 0.45,
  patternContrast: 0.6,
  patchiness: 0.12,
  earNotch: 0.55,
  earNotchOnLeft: true,
}

const BELLE = {
  ...defaultCat(),
  pattern: CoatPattern.calico,
  base: fromHex(0xa38b71),
  accent: fromHex(0xc07c39),
  eye: fromHex(0x8fae68),
  nose: fromHex(0xe3a6a0),
  size: 1.0,
  build: -0.1,
  capCoverage: 0.6,
  faceBlaze: 0.46,
  saddle: 0.58,
  chestWhite: 0.72,
  socks: 0.7,
  tailBands: 0.2,
  patternContrast: 0.42,
  patchiness: 0.6,
}

// ----------------------------------------------------------------- the hero

function fitCanvas (canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const rect = canvas.getBoundingClientRect()
  canvas.width = Math.max(1, Math.round(rect.width * dpr))
  canvas.height = Math.max(1, Math.round(rect.height * dpr))
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, width: rect.width, height: rect.height }
}

/// Runs one or more pets on a canvas. Kept small: a clock, a draw call per pet,
/// and pointer handling that hit-tests by horizontal distance.
function runStage (canvas, pets, options = {}) {
  let view = fitCanvas(canvas)
  const observer = new ResizeObserver(() => {
    try { view = fitCanvas(canvas) } catch (err) { console.warn('stage resize', err) }
  })
  observer.observe(canvas)

  let last = performance.now()
  let running = true

  function frame (now) {
    if (!running) return
    try {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      view.ctx.clearRect(0, 0, view.width, view.height)
      for (const pet of pets) {
        pet.draw(view.ctx, { width: view.width, height: view.height, ...options }, dt)
      }
    } catch (err) {
      console.warn('stage frame', err)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // Pointer handling. The pet nearest the pointer horizontally gets the event,
  // which is accurate enough for something the size of a thumbnail and avoids
  // reading pixels back every click.
  const nearest = event => {
    const rect = canvas.getBoundingClientRect()
    const fraction = (event.clientX - rect.left) / rect.width
    let best = pets[0]
    let bestD = Infinity
    for (const pet of pets) {
      const d = Math.abs(pet.position - fraction)
      if (d < bestD) { bestD = d; best = pet }
    }
    return { pet: best, fraction, hit: bestD < 0.22 }
  }

  let holding = null
  let holdTimer = null
  let dragged = false

  canvas.addEventListener('pointerdown', e => {
    const { pet, hit } = nearest(e)
    if (!hit) return
    canvas.setPointerCapture(e.pointerId)
    holding = pet
    dragged = false
    holdTimer = setTimeout(() => { if (holding) holding.pet(true) }, 380)
  })

  canvas.addEventListener('pointermove', e => {
    if (!holding) return
    const rect = canvas.getBoundingClientRect()
    const fraction = (e.clientX - rect.left) / rect.width
    if (Math.abs(fraction - holding.position) > 0.02) {
      dragged = true
      clearTimeout(holdTimer)
      holding.position = Math.min(0.94, Math.max(0.06, fraction))
      holding.moveTo(holding.position)
    }
  })

  const release = () => {
    if (!holding) return
    clearTimeout(holdTimer)
    holding.pet(false)
    if (!dragged) holding.poke()
    holding = null
  }
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)

  return { stop () { running = false; observer.disconnect() } }
}

async function startHero () {
  const canvas = $('hero-stage')
  const momo = createStage({ appearance: MOMO, quality: 0.5 })
  const belle = createStage({ appearance: BELLE, quality: 0.5 })
  momo.position = 0.34
  belle.position = 0.64

  // Only what the hero needs, so the pets appear in about a second rather than
  // after the whole animation library has been drawn.
  const first = ['sit', 'blink', 'walk', 'speak']
  await Promise.all([momo.ensure(first), belle.ensure(first)])
  momo.play('sit')
  belle.play('sit')
  runStage(canvas, [momo, belle], { floor: 0.9, scale: 0.52 })
  $('hero-hint').textContent = 'Momo & Belle — click them'

  // The rest fills in quietly behind the scenes.
  const rest = ['lookAround', 'groom', 'loaf', 'sleep', 'stretch', 'purr', 'slowBlink', 'trot']
  momo.ensure(rest)
  belle.ensure(rest)
}
if (!DESKTOP) {
  startHero().catch(err => {
    console.error(err)
    const hint = $('hero-hint')
    if (hint) hint.textContent = 'The live preview failed to start — try a refresh.'
  })
}

// ------------------------------------------------------------------ studio

// There is no server on the other end of these — everything runs in this tab —
// but the tab itself is not unlimited: an enormous photo or video is exactly
// the kind of thing that hangs it or gets it killed for memory, especially on a
// phone. Checked on the raw file, before anything gets decoded, so a mistaken
// pick fails in an instant instead of after the spinner has been running for a
// while. (The video pipeline's own length limit lives in analyzer/frames.js,
// next to the sampling loop whose cost it is actually protecting.)
const MAX_PHOTO_BYTES = 30 * 1024 * 1024
const MAX_VIDEO_BYTES = 300 * 1024 * 1024

const formatMB = bytes => `${Math.round(bytes / (1024 * 1024))} MB`

const state = {
  species: Species.cat,
  speciesLocked: false,   // true once the person picks for themselves
  /// One entry per slot: { image, small, mask, species, shape }.
  shots: {},
  /// Which shot the eye picker is showing. The face shot when there is one.
  selected: null,
  lastNotes: [],
  appearance: null,
  eye: null,
  name: '',
  stage: null,
  runner: null,
}

$('pick-cat').addEventListener('click', () => setSpecies(Species.cat))
$('pick-dog').addEventListener('click', () => setSpecies(Species.dog))

function setSpecies (s, { byUser = true } = {}) {
  if (byUser) state.speciesLocked = true
  state.species = s
  $('pick-cat').setAttribute('aria-pressed', String(s === Species.cat))
  $('pick-dog').setAttribute('aria-pressed', String(s === Species.dog))
  slotArt.rebuild()
}

// ---- progress, and getting the models ready

function showProgress (done, total, label) {
  $('progress').classList.remove('hidden')
  $('progress-label').classList.remove('hidden')
  $('progress').firstElementChild.style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`
  $('progress-label').textContent = label
}

function hideProgress () {
  $('progress').classList.add('hidden')
  $('progress-label').classList.add('hidden')
}

// Start fetching the models when the studio scrolls into view, so the ~20 MB
// download overlaps with the person finding their photos rather than following it.
// If it fails — offline, an old browser, a blocked CDN — the classical cutout still
// works and nothing else here has to change.
let visionReady = null
function warmVision () {
  if (visionReady) return visionReady
  const note = $('vision-note')
  visionReady = Vision.prepare(status => {
    if (note && status.startsWith('downloading')) {
      note.textContent = `Getting ready — ${status.replace('downloading ', '')}`
    }
  }).then(ok => {
    if (note) {
      note.textContent = ok
        ? 'Ready. Your pet is found automatically in each photo, on your own machine.'
        : 'Working offline, so a simpler cutout will be used — click your pet if it gets it wrong.'
    }
    return ok
  })
  return visionReady
}

// With a 500px margin this fired at page load — the studio sits just under the
// fold — so every visitor paid ~20 MB and a pegged core to read the hero. It now
// waits until the studio is actually on screen, and starts immediately if anyone
// touches it before then.
const studioEl = document.querySelector('.studio')
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) { warmVision(); io.disconnect() }
  }, { threshold: 0.15 })
  io.observe(studioEl)
}
studioEl.addEventListener('pointerdown', () => warmVision(), { once: true })

// ---- the shot list
//
// The interface asks for four named viewpoints instead of accepting a pile and
// guessing. That is not a photography lesson dressed up as a form: between them
// those four are the only way to *see* every parameter, and asking is also the
// cheapest and most accurate classifier there is. When someone fills the slot
// labelled "looking at you", the shot type is known exactly, for nothing.
//
// Geometry alone genuinely cannot do this. Scoring frames from the project's own
// footage put a photograph of a cat's back into the face slot with 0.92
// confidence, because at close range a back is exactly what a face looks like to a
// shape detector: a big, compact, roughly square blob.

function slotsHost () { return $('slots') }

// ---- the little cats in the empty slots
//
// Drawn by the same engine that draws the real pets, posed in exactly the viewpoint
// the slot is asking for, and looping gently so they breathe and blink. Free, in
// the sense that the renderer already existed — and much friendlier than the
// hand-drawn glyphs this replaced, which read as masks rather than animals.

// A soft rounded tile rather than a circle. Two of the four viewpoints are wide —
// a cat seen from the side is half again as wide as it is tall — and a circular
// frame clips a wide subject's extremities into its corners, which is why the side
// and tail illustrations had their ears and feet cut off.
const ART_W = 136
const ART_H = 112

const slotArt = (() => {
  const canvases = new Map()
  const loops = new Map()
  let started = false

  function petFor (species, overrides = {}) {
    const a = species === Species.dog ? defaultDog() : defaultCat()
    return {
      ...a,
      base: fromHex(SLOT_PET.base),
      accent: fromHex(SLOT_PET.accent),
      eye: fromHex(SLOT_PET.eye),
      nose: fromHex(SLOT_PET.nose),
      capCoverage: SLOT_PET.capCoverage,
      faceBlaze: SLOT_PET.faceBlaze,
      chestWhite: SLOT_PET.chestWhite,
      socks: SLOT_PET.socks,
      patternContrast: SLOT_PET.patternContrast,
      tailBands: SLOT_PET.tailBands,
      size: SLOT_PET.size,
      ...overrides,
    }
  }

  /// Pre-render one slot's loop as bitmaps, framed by `view`.
  async function build (id, species) {
    const spec = SLOT_ART[id]
    const pet = petFor(species, spec.pet)
    const unique = [...new Set(spec.frames)]
    const bitmaps = new Map()

    for (const frame of unique) {
      const shot = renderFrame(pet, {
        animation: spec.clip, frame, facing: spec.facing, quality: 0.62,
      })
      bitmaps.set(frame, await crop(shot, spec.view))
    }
    return spec.frames.map(f => bitmaps.get(f))
  }

  /// Where the drawn pixels actually are. Framing by the sprite's own bounds is
  /// the only way to centre it: the rig leaves different amounts of empty canvas
  /// depending on the pose, and fixed fractional crops left every illustration
  /// floating high in its disc with the ears clipped off.
  function opaqueBounds (rgba, size) {
    let minX = size, maxX = -1, minY = size, maxY = -1
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (rgba[(y * size + x) * 4 + 3] < 12) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (maxX < 0) return { x: 0, y: 0, w: size, h: size }
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  }

  /// Frame the render into a square window. The head crop trusts the rig's own
  /// idea of where the head is, which is the only reliable source for it.
  async function crop (shot, view) {
    const { rgba, size, meta } = shot
    const source = new OffscreenCanvas(size, size)
    source.getContext('2d').putImageData(new ImageData(rgba, size, size), 0, 0)

    // What to look at, in the sprite's own coordinates.
    let box
    let pad = 1.10
    if (view === 'head') {
      // Wide enough for the ear tips and the whiskers, both of which reach well
      // beyond the skull and both of which looked clipped when this was tighter.
      const r = Math.max(meta.headRX, meta.headRY) * 1.52
      box = { x: meta.headX - r, y: meta.headY - r + meta.headRY * 0.14, w: r * 2, h: r * 2 }
      pad = 1.12
    } else {
      box = opaqueBounds(rgba, size)
    }

    // Fit it inside the tile, whole, with a little air — never fill and crop.
    const scale = Math.min(ART_W / (box.w * pad), ART_H / (box.h * pad))
    const dw = box.w * scale
    const dh = box.h * scale
    // Sitting on a notional floor rather than dead-centre: an animal centred in a
    // box looks like it is falling, and a couple of pixels of ground under the
    // feet is most of what makes these read as friendly.
    const dx = (ART_W - dw) / 2
    const dy = (ART_H - dh) / 2 + (view === 'head' ? 0 : (ART_H - dh) * 0.28)

    const out = new OffscreenCanvas(ART_W, ART_H)
    const ctx = out.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, box.x, box.y, box.w, box.h, dx, dy, dw, dh)
    return out.transferToImageBitmap ? out.transferToImageBitmap() : out
  }

  function attach (id, canvas) {
    canvases.set(id, canvas)
    if (!loops.has(id)) {
      loops.set(id, null)
      build(id, state.species).then(frames => { loops.set(id, frames); paint() })
    }
    start()
  }

  /// One clock for all four, at a slow six frames a second. Any faster and four
  /// looping cats start competing with the page rather than decorating it.
  function start () {
    if (started) return
    started = true
    let last = 0
    const tick = now => {
      if (now - last > 1000 / 6) { last = now; paint() }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  let step = 0
  function paint () {
    step++
    for (const [id, canvas] of canvases) {
      if (!canvas.isConnected) { canvases.delete(id); continue }
      const frames = loops.get(id)
      if (!frames || !frames.length) continue
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, ART_W, ART_H)
      ctx.drawImage(frames[step % frames.length], 0, 0)
    }
  }

  /// Redraw for the other species when the toggle changes.
  function rebuild () {
    for (const id of [...loops.keys()]) {
      loops.set(id, null)
      build(id, state.species).then(frames => { loops.set(id, frames); paint() })
    }
  }

  return { attach, rebuild }
})()



function renderSlots () {
  const host = slotsHost()
  host.textContent = ''
  for (const shot of SHOTS) {
    const filled = state.shots[shot.id]
    const el = document.createElement('div')
    el.className = 'slot'
    el.dataset.state = filled ? 'filled' : (shot.essential ? 'wanted' : 'idle')
    el.tabIndex = 0
    el.setAttribute('role', 'button')
    el.setAttribute('aria-label', `${shot.title} — ${shot.hint}`)

    if (filled) {
      const canvas = document.createElement('canvas')
      canvas.className = 'shot'
      drawCutout(canvas, filled)
      el.appendChild(canvas)
      const clear = document.createElement('button')
      clear.className = 'clear'
      clear.textContent = '×'
      clear.title = 'Use a different photo'
      clear.addEventListener('click', e => {
        e.stopPropagation()
        delete state.shots[shot.id]
        refreshCapture()
      })
      el.appendChild(clear)
    } else {
      const art = document.createElement('div')
      art.className = 'art'
      const canvas = document.createElement('canvas')
      canvas.width = ART_W
      canvas.height = ART_H
      art.appendChild(canvas)
      el.appendChild(art)
      slotArt.attach(shot.id, canvas)
    }

    const title = document.createElement('h4')
    title.textContent = shot.title
    el.appendChild(title)
    const hint = document.createElement('p')
    hint.textContent = filled ? 'Tap to use a different one' : shot.hint
    if (!(filled && filled.grade)) el.appendChild(hint)
    const tag = document.createElement('span')
    tag.className = 'tag'
    if (filled?.grade) {
      // A number and then, if it is not good enough, the one thing to change. The
      // percentage on its own would just be a score with no move attached to it.
      const g = filled.grade
      tag.dataset.grade = g.verdict
      tag.textContent = `${Math.round(g.score * 100)}%${g.verdict === 'great' ? ' ✓' : ''}`
      el.dataset.grade = g.verdict
      const why = document.createElement('p')
      why.className = 'why'
      why.textContent = g.verdict === 'great' ? g.reasons[0] : g.reasons[0]
      el.appendChild(tag)
      el.appendChild(why)
      if (g.verdict === 'poor') {
        const again = document.createElement('button')
        again.className = 'again'
        again.textContent = 'Try another photo'
        again.addEventListener('click', e => { e.stopPropagation(); pickForSlot(shot.id) })
        el.appendChild(again)
      }
    } else {
      tag.textContent = filled ? 'got it ✓' : (shot.essential ? 'please' : 'if you have one')
      el.appendChild(tag)
    }

    const choose = () => pickForSlot(shot.id)
    el.addEventListener('click', choose)
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose() } })
    host.appendChild(el)
  }
}

/// Draw a slot's cutout: the animal in colour, the room dimmed away, cropped to
/// the animal itself. The crop matters — a correct cutout shown as a speck in the
/// middle of a room tells the person nothing about whether it worked.
function drawCutout (canvas, shot, w = ART_W, h = ART_H) {
  const { small, mask, shape } = shot
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const out = new ImageData(w, h)

  // The same window the illustrations use, so filling a slot reads as the little
  // drawn cat being replaced by their own animal rather than as a different kind
  // of picture appearing.
  const box = shape?.box ?? { x: 0, y: 0, w: small.width, h: small.height }
  // Contain the animal, but never magnify a small mask up to fill the tile: a
  // forty-pixel head blown up to a hundred and thirty is an unreadable blur, and
  // the point of this thumbnail is that a person can glance at it and agree that
  // the right animal was found. A floor on the window keeps some room in shot.
  const fit = Math.max((box.w * 1.12) / w, (box.h * 1.12) / h)
  const floor = (small.width * 0.52) / w
  const scale = Math.max(fit, floor)
  const left = box.x + box.w / 2 - (w * scale) / 2
  const top = box.y + box.h / 2 - (h * scale) / 2

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4
      const sx = Math.round(left + x * scale)
      const sy = Math.round(top + y * scale)
      if (sx < 0 || sy < 0 || sx >= small.width || sy >= small.height) {
        out.data[d + 3] = 0
        continue
      }
      const si = (sy * small.width + sx) * 4
      const on = mask[sy * small.width + sx]
      // The room stays visible, just muted. Dimmed almost to black it read as a
      // dark fragment rather than a photograph with the pet lifted out of it.
      out.data[d] = on ? small.data[si] : small.data[si] * 0.46 + 16
      out.data[d + 1] = on ? small.data[si + 1] : small.data[si + 1] * 0.46 + 19
      out.data[d + 2] = on ? small.data[si + 2] : small.data[si + 2] * 0.46 + 24
      out.data[d + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
}

/// One hidden input, reused. Created per use so choosing the same file twice in a
/// row still fires a change event.
function pickForSlot (id) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return
    if (file.size > MAX_PHOTO_BYTES) {
      showProgress(1, 1, `That photo is ${formatMB(file.size)} — a bit large. Try one under ${formatMB(MAX_PHOTO_BYTES)}?`)
      setTimeout(hideProgress, 3000)
      return
    }
    showProgress(0, 1, 'Looking at that one…')
    try {
      const image = await frameFromImage(file)
      const shot = await prepareShot(image)
      if (!shot) {
        showProgress(1, 1, 'No cat or dog found in that photo — try another?')
        setTimeout(hideProgress, 2600)
        return
      }
      state.shots[id] = gradeShot(shot, id)
      voteSpecies()
      hideProgress()
      refreshCapture()
      track(`shot:${id}`)
    } catch (err) {
      console.warn(err)
      showProgress(1, 1, err.message || 'That photo could not be read.')
      setTimeout(hideProgress, 2600)
    }
  })
  input.click()
}

/// Detect, cut out and measure the shape of one photograph. Everything the shot
/// list needs to know about an image lives in the object this returns.
async function prepareShot (image) {
  const small = toSmall(image)
  let mask = null
  let species = null
  let uncertain = false

  if (await warmVision()) {
    try {
      const read = await Vision.readPhoto(image)
      if (!read) return null      // the detector is sure there is no animal here
      mask = shrinkMask(read.mask, { width: read.width, height: read.height }, small)
      species = read.species
      uncertain = read.uncertain
    } catch (err) {
      console.warn('[vision] falling back to the classical cutout:', err)
    }
  }
  if (!mask) mask = segment(small).mask

  const shape = shapeOf(mask, small.width, small.height)
  return { image, small, mask, species, uncertain, shape }
}

/// Attach a quality reading for the slot a shot is going into. Done here rather
/// than inside prepareShot because the same photograph is worth more in one slot
/// than another, and the slot is not known until it is placed.
function gradeShot (shot, slotId) {
  if (!shot) return shot
  shot.grade = scoreCapture(shot, slotId, shot.shape ? scoreShot(shot.shape) : null)
  return shot
}

function voteSpecies () {
  if (state.speciesLocked) return
  const votes = Object.values(state.shots).map(s => s.species).filter(Boolean)
  if (!votes.length) return
  const dogs = votes.filter(v => v === 'dog').length
  setSpecies(dogs * 2 > votes.length ? Species.dog : Species.cat, { byUser: false })
}

/// A photo this weak is not evidence. It can stay in its slot — throwing away
/// someone's photograph without asking is rude, and they may have nothing better
/// — but it does not count towards being ready to build.
const USABLE = 0.50
const GOOD = 0.80

// A missing shot is not a usable one. Written as `!shot?.grade || ...` first,
// which quietly returned true for an empty slot and enabled Build with one photo
// in a screen that needs two.
const usable = shot => Boolean(shot) && (!shot.grade || shot.grade.score >= USABLE)

function refreshCapture () {
  renderSlots()
  const any = Object.keys(state.shots).length > 0

  // The stage is now visible from the very start, with the invitation on it. An
  // empty box you have to imagine a pet into is worth nothing; an empty box that
  // says what will appear there, and then fills the moment the first photo lands,
  // is the whole loop this screen is trying to teach.
  $('peek').classList.remove('hidden')
  $('peek').dataset.empty = any ? 'no' : 'yes'

  const haveEssentials = ESSENTIAL.every(id => usable(state.shots[id]))
  $('analyse').disabled = !haveEssentials

  const weak = Object.entries(state.shots)
    .filter(([, shot]) => shot.grade && shot.grade.score < GOOD)
    .map(([id]) => SHOTS.find(s => s.id === id).title.toLowerCase())
  const missing = ESSENTIAL.filter(id => !usable(state.shots[id]))
    .map(id => SHOTS.find(s => s.id === id).title.toLowerCase())

  if (!any) {
    $('peek-label').textContent = 'Add a photo, and meet your pet right here.'
  } else if (missing.length) {
    $('peek-label').textContent = `This is them so far. Add ${missing.join(' and ')} to fill them in.`
  } else if (weak.length) {
    $('peek-label').textContent =
      `Good enough to build. A sharper ${weak.join(' or ')} would make them look more like themselves.`
  } else {
    $('peek-label').textContent = 'That is a strong set — this should look like them.'
  }
  updatePeek()
}

// ---- the live preview
//
// The pet is rebuilt every time a slot changes, which is the only teaching this
// interface does: someone adds the side view, the stripes appear, and they work out
// for themselves that more angles means more of their animal.

let peekStage = null
let peekRunner = null
let peekPending = false

async function updatePeek () {
  if (!Object.keys(state.shots).length) return   // nothing measured yet; the empty state is CSS
  if (peekPending) return
  peekPending = true
  try {
    const reading = readFromShots(shotsForReading(), { species: state.species, eye: state.eye })
    state.appearance = reading.appearance
    state.lastNotes = reading.notes
    if (!peekStage) {
      peekStage = createStage({ appearance: reading.appearance, quality: 0.5 })
      await peekStage.ensure(['sit', 'blink'])
      peekStage.play('sit')
      peekRunner = runStage($('peek-stage'), [peekStage], { floor: 0.92, scale: 0.72 })
      peekStage.ensure(['walk', 'speak', 'lookAround', 'groom'])
    } else {
      peekStage.update({ ...reading.appearance })
      await peekStage.ensure(['sit', 'blink'])
    }
  } finally {
    peekPending = false
  }
}

function shotsForReading () {
  const out = {}
  for (const [id, shot] of Object.entries(state.shots)) {
    // The grade the slot is already showing is also how much this photo should
    // count when the readings are combined.
    out[id] = { image: shot.small, mask: shot.mask, weight: shot.grade?.score }
  }
  return out
}

// ---- the video shortcut
//
// The easiest thing a person can do is film their pet for ten seconds, and it is
// also the best input: one walk around them contains every angle in the same
// light. Frames are scored against each other rather than against absolute
// thresholds, which is what makes sorting them reliable.

$('choose-video').addEventListener('click', () => $('video-input').click())
$('video-input').addEventListener('change', async () => {
  const file = $('video-input').files?.[0]
  if (!file) return
  await fromVideo(file)
})

async function fromVideo (file) {
  if (file.size > MAX_VIDEO_BYTES) {
    showProgress(1, 1, `That video is ${formatMB(file.size)} — a shorter clip works just as well. Try one under ${formatMB(MAX_VIDEO_BYTES)}?`)
    setTimeout(hideProgress, 3400)
    return
  }
  showProgress(0, 1, 'Reading the video…')
  let frames = []
  try {
    frames = await framesFromVideo(file, {
      want: 14, sample: 26,
      onProgress: (done, total) => showProgress(done, total * 2, `Reading the video — frame ${done} of ${total}`),
    })
  } catch (err) {
    showProgress(1, 1, err.message || 'That video could not be read.')
    setTimeout(hideProgress, 3000)
    return
  }

  await warmVision()
  const candidates = []
  for (const [i, image] of frames.entries()) {
    showProgress(frames.length + i, frames.length * 2, `Looking for your pet — ${i + 1} of ${frames.length}`)
    const shot = await prepareShot(image)
    if (shot?.shape) candidates.push(shot)
    await new Promise(r => setTimeout(r, 0))
  }
  hideProgress()

  if (!candidates.length) {
    showProgress(1, 1, 'No cat or dog turned up in that video — try photos instead?')
    setTimeout(hideProgress, 3200)
    return
  }

  // Sharpness relative to the sharpest frame in this video, used only to break
  // ties between frames that score alike.
  const best = Math.max(...candidates.map(c => c.shape.area))
  for (const c of candidates) c.quality = c.shape.area / best

  const { filled } = assignShots(candidates)
  // Everything except the face, which shape cannot judge — a back at close range
  // looks exactly like a face to a geometry test, so that one gets asked about.
  for (const id of ['side', 'front', 'tail']) {
    if (filled[id]) state.shots[id] = gradeShot(filled[id], id)
  }
  voteSpecies()
  refreshCapture()
  track('video:used')

  offerFaces(candidates)
}

/// Ask which frame shows the face. One tap, and it doubles as the moment to pick
/// the eye colour — a tap on an eye is by definition a tap on the face.
function offerFaces (candidates) {
  // Frames whose cutout the segmenter itself was unsure about are dropped first.
  // Two of six candidates in testing were cushions and blankets that SAM had
  // grabbed instead of the cat, and offering those makes the question harder than
  // it needs to be. If that leaves nothing, show the lot rather than nothing.
  const trusted = candidates.filter(c => !c.uncertain)
  const ranked = [...(trusted.length >= 3 ? trusted : candidates)]
    .map(c => ({ c, score: scoreShot(c.shape).face }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
  if (!ranked.length) return

  const host = $('candidates')
  host.textContent = ''
  for (const { c } of ranked) {
    const button = document.createElement('button')
    button.className = 'candidate'
    const canvas = document.createElement('canvas')
    drawCutout(canvas, c)
    button.appendChild(canvas)
    button.addEventListener('click', () => {
      state.shots.face = gradeShot(c, 'face')
      state.selected = c
      $('face-pick').classList.add('hidden')
      voteSpecies()
      refreshCapture()
      track('face:chosen')
    })
    host.appendChild(button)
  }
  $('face-pick').classList.remove('hidden')
  $('face-pick').scrollIntoView({ block: 'center', behavior: 'smooth' })
}

// ---- analysis

$('analyse').addEventListener('click', async () => {
  $('analyse').disabled = true
  showProgress(0, 1, 'Measuring their colours…')
  await new Promise(r => setTimeout(r, 30))

  const { appearance, notes } = readFromShots(shotsForReading(),
    { species: state.species, eye: state.eye })
  state.appearance = appearance
  hideProgress()
  showResult(notes)
  track('pet:built')
})

$('skip').addEventListener('click', () => {
  state.appearance = starting(state.species)
  showResult(['Started from a blank pet — everything here is yours to set.'])
  track('pet:blank')
})

$('restart').addEventListener('click', () => {
  state.runner?.stop()
  state.runner = null
  state.stage = null
  state.shots = {}
  state.selected = null
  state.eye = null
  state.appearance = null
  refreshCapture()
  $('stage-result').classList.add('hidden')
  $('stage-upload').classList.remove('hidden')
})

async function showResult (notes) {
  $('stage-upload').classList.add('hidden')
  $('stage-result').classList.remove('hidden')

  $('notes').textContent = ''
  for (const note of notes) {
    const li = document.createElement('li')
    li.textContent = note
    $('notes').appendChild(li)
  }

  buildControls()
  // Naming them is the one thing here only their person can do, so the cursor is
  // already waiting in that box when they first see their pet.
  if (!state.name) $('pet-name')?.focus()
  // The eye picker shows the face shot when there is one, because that is the only
  // photo an eye is reliably visible in.
  state.selected = state.shots.face || state.shots.front || Object.values(state.shots)[0] || null
  if (state.selected) {
    $('eye-picker').classList.remove('hidden')
    buildEyePicker()
  }

  state.runner?.stop()
  state.stage = createStage({ appearance: state.appearance, quality: 0.62 })
  await state.stage.ensure(['sit', 'blink', 'walk', 'speak'])
  state.stage.play('sit')
  state.runner = runStage($('studio-stage'), [state.stage], { floor: 0.9, scale: 0.74 })
  state.stage.ensure(['lookAround', 'groom', 'loaf', 'sleep', 'stretch', 'purr', 'slowBlink', 'trot'])
}

// ---- clicking the eye

function buildEyePicker () {
  const photo = state.selected
  if (!photo) return
  const host = $('pickwrap')
  host.textContent = ''

  const canvas = document.createElement('canvas')
  const view = photo.image
  canvas.width = view.width
  canvas.height = view.height
  canvas.style.width = `${Math.round(view.width * Math.min(1, 420 / view.width))}px`
  const ctx = canvas.getContext('2d')

  // The cutout is shown, not the raw photo, so the person can see what was found
  // and whether it needs correcting.
  const repaint = () => {
    const small = photo.small
    const big = new ImageData(view.width, view.height)
    for (let y = 0; y < view.height; y++) {
      for (let x = 0; x < view.width; x++) {
        const i = (y * view.width + x) * 4
        const sx = Math.min(small.width - 1, Math.floor((x / view.width) * small.width))
        const sy = Math.min(small.height - 1, Math.floor((y / view.height) * small.height))
        const on = photo.mask[sy * small.width + sx]
        big.data[i] = on ? view.data[i] : view.data[i] * 0.3 + 18
        big.data[i + 1] = on ? view.data[i + 1] : view.data[i + 1] * 0.3 + 21
        big.data[i + 2] = on ? view.data[i + 2] : view.data[i + 2] * 0.3 + 26
        big.data[i + 3] = 255
      }
    }
    ctx.putImageData(big, 0, 0)
  }
  repaint()
  host.appendChild(canvas)

  const dot = document.createElement('div')
  dot.className = 'pick-dot hidden'
  host.appendChild(dot)

  // One canvas, two gestures: a drag draws a box around the pet and re-runs the
  // cutout inside it; a click without a drag picks the eye colour. Both are things
  // only the person looking at the photo can do reliably, and neither needs a
  // model or a round trip.
  let dragStart = null
  let dragging = false

  const toImage = e => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }

  canvas.addEventListener('pointerdown', e => {
    dragStart = toImage(e)
    dragging = false
    canvas.setPointerCapture(e.pointerId)
  })

  canvas.addEventListener('pointermove', e => {
    if (!dragStart) return
    const now = toImage(e)
    if (Math.abs(now.x - dragStart.x) < 0.03 && Math.abs(now.y - dragStart.y) < 0.03) return
    dragging = true
    repaint()
    ctx.strokeStyle = '#ffca7a'
    ctx.lineWidth = Math.max(2, view.width / 200)
    ctx.setLineDash([6, 5])
    ctx.strokeRect(
      Math.min(dragStart.x, now.x) * view.width,
      Math.min(dragStart.y, now.y) * view.height,
      Math.abs(now.x - dragStart.x) * view.width,
      Math.abs(now.y - dragStart.y) * view.height
    )
    ctx.setLineDash([])
  })

  canvas.addEventListener('pointerup', async e => {
    if (!dragStart) return
    const end = toImage(e)
    const start = dragStart
    dragStart = null

    if (dragging) {
      photo.box = {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        w: Math.abs(end.x - start.x),
        h: Math.abs(end.y - start.y),
      }
      await recut(photo, { box: photo.box })
      repaint()
      refreshCapture()
      reanalyse()
      track('mask:corrected')
      return
    }

    // A click does two jobs, because a click on your pet's eye is by definition a
    // click on your pet: it reads the iris colour, and it is the best possible
    // prompt for the segmenter. Re-cutting from that point rescues exactly the
    // photographs the automatic pass gives up on.
    pickEyeAt(end, view, dot, canvas)
    if (photo.shape && scoreShot(photo.shape).face < 0.25) {
      await recut(photo, { point: end, box: photo.box })
      repaint()
      refreshCapture()
      reanalyse()
    }
  })
}

/// Cut a photograph again with a better prompt — a box someone dragged, or the
/// point where they clicked their pet. Falls back to the classical method when
/// the model is not available.
async function recut (photo, { box = null, point = null }) {
  if (await warmVision()) {
    try {
      const read = await Vision.segmentWithSam(photo.image, { box, point })
      photo.mask = shrinkMask(read.mask, { width: read.width, height: read.height }, photo.small)
      photo.shape = shapeOf(photo.mask, photo.small.width, photo.small.height)
      return
    } catch (err) {
      console.warn('[vision] re-cut failed, using the classical cutout:', err)
    }
  }
  photo.mask = segment(photo.small, box).mask
  photo.shape = shapeOf(photo.mask, photo.small.width, photo.small.height)
}

/// Average a tiny disc rather than one pixel, so a single noisy sample or a
/// catchlight does not decide the colour. The pupil and the catchlight are both
/// skipped: every eye has them, and neither is its colour.
function pickEyeAt (point, view, dot, canvas) {
  const x = Math.round(point.x * view.width)
  const y = Math.round(point.y * view.height)
  let r = 0, g = 0, b = 0, count = 0
  const radius = Math.max(1, Math.round(Math.min(view.width, view.height) * 0.006))
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = x + dx, py = y + dy
      if (px < 0 || py < 0 || px >= view.width || py >= view.height) continue
      const i = (py * view.width + px) * 4
      const lum = (0.2126 * view.data[i] + 0.7152 * view.data[i + 1] + 0.0722 * view.data[i + 2]) / 255
      if (lum < 0.12 || lum > 0.95) continue
      r += view.data[i]; g += view.data[i + 1]; b += view.data[i + 2]; count++
    }
  }
  if (!count) return

  state.eye = { r: r / count / 255, g: g / count / 255, b: b / count / 255 }
  state.appearance.eye = { ...state.eye }
  state.stage?.update({ ...state.appearance })
  buildControls()

  dot.classList.remove('hidden')
  dot.style.left = `${point.x * 100}%`
  dot.style.top = `${point.y * 100}%`
  dot.style.background = toHex(state.eye)
  track('eye:picked')
}

/// Re-run the measurement after a mask correction, keeping any eye colour the
/// person already picked.
function reanalyse () {
  const { appearance, notes } = readFromShots(shotsForReading(),
    { species: state.species, eye: state.eye })
  state.appearance = appearance
  state.stage?.update({ ...appearance })
  buildControls()
  $('notes').textContent = ''
  for (const note of notes) {
    const li = document.createElement('li')
    li.textContent = note
    $('notes').appendChild(li)
  }
}

// ---- the sliders

const SLIDERS = [
  ['capCoverage', 'Colour on the head', 'How much of the face carries colour rather than white'],
  ['faceBlaze', 'White stripe on the face', ''],
  ['chestWhite', 'White chest', ''],
  ['socks', 'White feet', ''],
  ['saddle', 'Colour over the back', ''],
  ['patternContrast', 'Stripes', ''],
  ['patchiness', 'Patches (calico, tortie)', ''],
  ['tailBands', 'Rings on the tail', ''],
  ['faceMask', 'Dark around the eyes', ''],
  ['furLength', 'Fluffiness', ''],
  ['size', 'Size', ''],
  ['build', 'Stockiness', ''],
  ['snout', 'Length of muzzle', ''],
  ['earNotch', 'Notch in one ear', 'A small thing, and often the thing you remember most'],
]

const MORPH_SLIDERS = [
  ['legLength', 'Leg length', 'Dogs stand clear of the ground; this is most of that silhouette'],
  ['chestDepth', 'Chest depth', ''],
  ['waistTuck', 'Waist tuck', ''],
  ['backLength', 'Back length', ''],
  ['toplineSlope', 'Topline slope', 'Shoulder higher than hip on a dog'],
  ['muzzleLength', 'Muzzle length', ''],
  ['skullWidth', 'Skull width', ''],
  ['earSize', 'Ear size', ''],
  ['tailLength', 'Tail length', ''],
  ['tailFluff', 'Tail fluff', ''],
  ['bodyMass', 'Body mass', ''],
  ['hockAngle', 'Hock', 'The backwards knee that reads as a dog'],
]

function buildControls () {
  const host = $('controls')
  host.textContent = ''
  const a = state.appearance

  // Asked properly, and asked first. The placeholder used to be "Momo" — this
  // app is *in memory of* Momo and Belle, it is not about them, and suggesting
  // someone else's cat's name to every person who ever uses it got that backwards.
  host.appendChild(field('What shall we call them?', () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.id = 'pet-name'
    input.autocomplete = 'off'
    input.placeholder = 'Their name'
    input.value = state.name
    input.addEventListener('input', () => { state.name = input.value })
    return input
  }))

  // Colours first: they carry more of the likeness than any slider.
  const colours = document.createElement('div')
  colours.className = 'field'
  const label = document.createElement('label')
  label.textContent = 'Colours'
  colours.appendChild(label)
  const swatches = document.createElement('div')
  swatches.className = 'swatches'
  for (const [key, name] of [['base', 'Coat'], ['accent', 'Second'], ['eye', 'Eyes'], ['nose', 'Nose']]) {
    const s = document.createElement('label')
    s.className = 'swatch'
    const picker = document.createElement('input')
    picker.type = 'color'
    picker.value = toHex(a[key])
    picker.addEventListener('input', () => {
      a[key] = fromHex(picker.value)
      state.stage?.update({ ...a })
    })
    s.appendChild(picker)
    s.appendChild(document.createTextNode(name))
    swatches.appendChild(s)
  }
  colours.appendChild(swatches)
  host.appendChild(colours)

  host.appendChild(field('Coat pattern', () => {
    const select = document.createElement('select')
    for (const key of Object.keys(CoatPattern)) {
      const option = document.createElement('option')
      option.value = key
      option.textContent = patternLabels[key]
      option.selected = a.pattern === key
      select.appendChild(option)
    }
    select.addEventListener('change', () => { a.pattern = select.value; state.stage?.update({ ...a }) })
    return select
  }))

  host.appendChild(field('Ears', () => {
    const select = document.createElement('select')
    for (const [key, name] of [[EarStyle.pointed, 'Pointed'], [EarStyle.rounded, 'Rounded'],
      [EarStyle.folded, 'Folded'], [EarStyle.floppy, 'Floppy']]) {
      const option = document.createElement('option')
      option.value = key
      option.textContent = name
      option.selected = a.earStyle === key
      select.appendChild(option)
    }
    select.addEventListener('change', () => { a.earStyle = select.value; state.stage?.update({ ...a }) })
    return select
  }))

  host.appendChild(field('Tail', () => {
    const select = document.createElement('select')
    for (const [key, name] of [[TailStyle.long, 'Long'], [TailStyle.fluffy, 'Fluffy'],
      [TailStyle.curled, 'Curled'], [TailStyle.stubby, 'Short']]) {
      const option = document.createElement('option')
      option.value = key
      option.textContent = name
      option.selected = a.tailStyle === key
      select.appendChild(option)
    }
    select.addEventListener('change', () => { a.tailStyle = select.value; state.stage?.update({ ...a }) })
    return select
  }))

  const advanced = document.createElement('details')
  advanced.className = 'advanced'
  const summary = document.createElement('summary')
  summary.textContent = 'Markings & colours'
  advanced.appendChild(summary)

  for (const [key, name, hint] of SLIDERS) {
    const wrap = document.createElement('div')
    wrap.className = 'field'
    const label = document.createElement('label')
    const min = key === 'build' ? -1 : key === 'size' ? 0.7 : 0
    const max = key === 'size' ? 1.4 : 1
    label.innerHTML = `<span>${name}</span><span class="muted">${a[key].toFixed(2)}</span>`
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(min)
    slider.max = String(max)
    slider.step = '0.01'
    slider.value = String(a[key])
    if (hint) slider.title = hint
    // Re-render on release rather than on every pixel of the drag: a full clip is
    // a few hundred milliseconds of work and dragging would queue dozens.
    slider.addEventListener('input', () => {
      a[key] = Number(slider.value)
      label.lastElementChild.textContent = a[key].toFixed(2)
    })
    slider.addEventListener('change', () => state.stage?.update({ ...a }))
    wrap.appendChild(label)
    wrap.appendChild(slider)
    advanced.appendChild(wrap)
  }

  const morphs = document.createElement('details')
  morphs.className = 'advanced'
  const morphSummary = document.createElement('summary')
  morphSummary.textContent = 'Body shape'
  morphs.appendChild(morphSummary)
  a.morphs = a.morphs || {}
  for (const [key, name, hint] of MORPH_SLIDERS) {
    const wrap = document.createElement('div')
    wrap.className = 'field'
    const label = document.createElement('label')
    const value = a.morphs[key] ?? 0
    label.innerHTML = `<span>${name}</span><span class="muted">${Number(value).toFixed(2)}</span>`
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = key === 'tailFluff' || key === 'earFold' ? '0' : '-1'
    slider.max = '1'
    slider.step = '0.01'
    slider.value = String(value)
    if (hint) slider.title = hint
    slider.addEventListener('input', () => {
      a.morphs[key] = Number(slider.value)
      label.lastElementChild.textContent = a.morphs[key].toFixed(2)
    })
    slider.addEventListener('change', () => state.stage?.update({ ...a, morphs: { ...a.morphs } }))
    wrap.appendChild(label)
    wrap.appendChild(slider)
    morphs.appendChild(wrap)
  }
  host.appendChild(advanced)
  host.appendChild(morphs)
}

function field (name, make) {
  const wrap = document.createElement('div')
  wrap.className = 'field'
  const label = document.createElement('label')
  label.textContent = name
  wrap.appendChild(label)
  wrap.appendChild(make())
  return wrap
}

// ---- saving the pet file

if (DESKTOP) $('save-pet').textContent = 'Put them on my desktop \u{1F43E}'

$('save-pet').addEventListener('click', () => {
  const pet = toPetFile(
    state.name || (state.species === Species.dog ? 'My dog' : 'My cat'),
    state.appearance,
  )
  // In the app the file round-trip is the thing we are removing: no download, no
  // Finder, no second step. Hand the pet to the main process and it moves in.
  if (DESKTOP) {
    window.stillDesktop.addPet(pet)
    track('pet:added')
    return
  }
  const blob = new Blob([JSON.stringify(pet, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  // The installer registers the bare `.pet` extension with the OS (see
  // package.json's `fileAssociations`) so double-clicking a saved file opens the
  // app. A `.pet.json` name defeats that silently — the OS sees `.json`, not
  // `.pet`, and nothing happens. The content is JSON either way; only the name
  // has to match what the installer promised.
  a.download = `${(pet.name || 'pet').replace(/[^\w-]+/g, '-').toLowerCase()}.pet`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  track('pet:saved')
})

// Draw the empty shot list straight away, so the page shows what it wants.
refreshCapture()
