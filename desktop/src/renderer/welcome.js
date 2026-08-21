// The welcome window's renderer.
//
// The pet in the header is drawn by the same engine that draws the real ones, so
// the window is showing the actual product rather than a screenshot of it that
// would rot the first time the art changed. On the finish screen it draws the
// pet that was just imported — their animal, not a stand-in.

import { defaultCat } from '../../../engine/appearance.js'
import { createStage } from '../../../engine/stage.js'

const $ = id => document.getElementById(id)

// Feet sit just above the bottom edge; the wrap has a floor-ish gradient there.
const FLOOR = 0.99
// Pet height as a fraction of canvas height. Larger than the desktop default
// because this canvas is a display case, not a whole screen.
const SCALE = 0.82

/// Runs one pet in one canvas until the window closes. Returns nothing: there is
/// no teardown, because the only way out of this window is closing it.
function mount (canvas, appearance) {
  const ctx = canvas.getContext('2d')
  const stage = createStage({ appearance, quality: 0.7 })
  stage.position = 0.5

  // Measured every frame rather than once at startup: the canvas is sized by the
  // layout, and a single measurement taken before the layout settled is how the
  // first version of this drew the pet three times too big and mostly off-screen.
  let backing = ''
  const fit = (width, height) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const key = `${width}x${height}@${dpr}`
    if (key === backing) return
    backing = key
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  let last = performance.now()
  let ready = false

  // The stage picks its own next move from the full idle set and wanders while it
  // does — that autonomy is the product, so the window shows it rather than a
  // frozen pose. Every clip it can choose is built up front: `build` is
  // synchronous and expensive, and reaching it from the draw loop is a visible
  // hitch each time a new one comes up.
  stage.ensure(['sit', 'blink', 'walk', 'speak']).then(() => {
    stage.play('sit')
    ready = true
    return stage.ensure(['lookAround', 'groom', 'loaf', 'sleep', 'stretch', 'slowBlink', 'trot'])
  })

  const frame = now => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const { width, height } = canvas.getBoundingClientRect()
    if (ready && width && height) {
      fit(width, height)
      ctx.clearRect(0, 0, width, height)
      stage.draw(ctx, { width, height, floor: FLOOR, scale: SCALE }, dt)
    }
    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
  return stage
}

// ------------------------------------------------------------------ views

// Each view has its own height; the window follows so neither is padded out with
// empty space or clipped at the bottom edge.
const HEIGHTS = { start: 740, done: 520 }

function show (which) {
  $('view-start').classList.toggle('on', which === 'start')
  $('view-done').classList.toggle('on', which === 'done')
  window.welcome.setHeight(HEIGHTS[which])
}

mount($('demo'), defaultCat())

// ---------------------------------------------------------------- buttons

$('create').addEventListener('click', () => window.welcome.create())
$('open').addEventListener('click', () => window.welcome.openFile())
$('finish').addEventListener('click', () => window.welcome.close())
$('website').addEventListener('click', event => {
  event.preventDefault()
  window.welcome.makeOne()
})

// A pet landing while this window is open is the end of the journey it exists to
// explain, so it switches to the finish screen rather than sitting there still
// telling someone to do the thing they have just done.
let announced = false

window.welcome.onImported(({ name, appearance }) => {
  announced = true
  $('done-title').innerHTML = `Say hello to <em>${escapeHtml(name)}</em>.`
  mountDone(appearance)
  show('done')
})

// Importing a second pet while the window is open would otherwise start another
// draw loop on the same canvas, each fighting the other for it.
let doneMounted = false
function mountDone (appearance) {
  if (doneMounted || !appearance) return
  doneMounted = true
  mount($('demo-done'), appearance)
}

// If the window is opened from the tray later, when pets already exist, the
// instructions are not what is wanted — the reminder about the menu bar is.
window.welcome.getState().then(({ hasPets, firstPet }) => {
  if (!hasPets || announced) return
  $('done-title').innerHTML = 'Your pets are <em>already here</em>.'
  $('done-body').textContent =
    'They are on the desktop right now. Drag one along the floor, or give it a poke.'
  mountDone(firstPet?.appearance)
  show('done')
})

function escapeHtml (s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
