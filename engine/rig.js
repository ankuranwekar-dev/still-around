// Pet anatomy.
//
// One rig, three views. Everything is a number, so poses interpolate cleanly —
// a walk cycle is just a handful of values moving. Shape lives here; colour
// lives in coat.js.
//
// Geometry is authored in a 64x64 space and scaled to the appearance's grid at
// the end. Authoring stays small and readable; the render happens at whatever
// resolution is asked for, and a bigger animal gets a bigger grid so it comes
// out physically larger rather than as a chunkier upscale.

import { Part, ellipse, capsule, polygon, layer } from './raster.js'
import { Species, EarStyle, TailStyle, gridFor } from './appearance.js'

export const BASE = 64

export function pose (overrides = {}) {
  return {
    view: 'front',
    facing: 1, // 1 right, -1 left
    bodyY: 0,
    crouch: 0,
    breathe: 0,
    headX: 0,
    headY: 0,
    headTilt: 0,
    earL: 0, // 0 upright, 1 flattened
    earR: 0,
    eyeOpen: 1,
    pupilDilate: 0.42,
    lookX: 0,
    lookY: 0,
    mouthOpen: 0,
    tailBase: 0,
    tailCurve: 0.18,
    tailWave: 0,
    tailPhase: 0,
    frontLegLift: 0,
    backLegLift: 0,
    gait: 0,
    legPhase: 0,
    stretch: 0,
    tuck: 0,
    frontPawReach: 0,
    headLow: 0,
    ...overrides,
  }
}

const lerp = (a, b, t) => a + (b - a) * t
const pt = (x, y) => ({ x, y })

export function build (p, a, quality = 1) {
  // Dogs get their own geometry rather than a cat with different ears.
  //
  // The first attempt at dogs parameterised the cat: floppy ears, a longer
  // snout, a bigger grid. Every single one still read as a cat, because what
  // makes a dog a dog is the skeleton — legs that stand it well clear of the
  // ground, a deep chest over a tucked waist, a topline that slopes from
  // shoulder to hip, and hocked back legs. None of those are colours or ear
  // shapes, so no amount of parameter tuning was ever going to get there.
  const dog = a.species === Species.dog
  let out
  if (p.view === 'side') out = dog ? sideViewDog(p, a) : sideView(p, a)
  else if (p.view === 'curl') out = dog ? curlViewDog(p, a) : curlView(p, a)
  else out = dog ? frontViewDog(p, a) : frontView(p, a)

  let layers = out.layers
  const meta = out.meta

  if (p.facing < 0) {
    layers = layers.map(mirror)
    meta.headX = BASE - meta.headX
  }

  const grid = gridFor(a, quality)
  const k = grid / BASE
  if (k !== 1) {
    layers = layers.map(l => scale(l, k))
    meta.headX *= k
    meta.headY *= k
    meta.headRX *= k
    meta.headRY *= k
  }
  meta.view = p.view
  meta.grid = grid
  return { layers, meta, grid }
}

// MARK: - Shared pieces

function tailChain (x, y, dir, p, a) {
  const out = []
  let segments, segLen, fluff
  let curve = p.tailCurve

  switch (a.tailStyle) {
    case TailStyle.fluffy: segments = 8; segLen = 2.6; fluff = 1.55; break
    case TailStyle.curled: segments = 8; segLen = 2.5; fluff = 1.15; curve += 0.30; break
    case TailStyle.stubby: segments = 4; segLen = 2.2; fluff = 1.2; break
    default: segments = 8; segLen = 2.8; fluff = 1.0
  }

  let angle = dir * (Math.PI * 0.15) + p.tailBase * dir
  let cx = x, cy = y
  const dog = a.species === Species.dog
  if (dog) segLen *= 0.88
  const baseR = (dog ? 3.35 : 3.0) * fluff * (0.85 + a.furLength * 0.5)

  for (let i = 0; i < segments; i++) {
    const t = i / Math.max(segments - 1, 1)
    const wave = Math.sin(p.tailPhase + i * 0.7) * p.tailWave
    angle += dir * curve + wave * dir
    const nx = cx + Math.cos(angle) * segLen * dir
    const ny = cy - Math.sin(angle) * segLen
    // Tapers to a rounded tip rather than a point — tails are blunt.
    const r0 = lerp(baseR, baseR * 0.66, t)
    const r1 = lerp(baseR, baseR * 0.66, Math.min(1, t + 0.13))
    out.push(layer(Part.tail, capsule(cx, cy, nx, ny, r0, r1), [i / segments, (i + 1) / segments]))
    cx = nx; cy = ny
  }
  return out
}

function ears (hx, hy, hrx, hry, p, a, profile = false) {
  const out = []

  for (const isLeft of [true, false]) {
    const s = isLeft ? -1 : 1
    const flat = isLeft ? p.earL : p.earR
    const outer = isLeft ? Part.earL : Part.earR
    const inner = isLeft ? Part.earInL : Part.earInR

    // Authoring assumes facing right, same as the eyes in face() below: s === 1
    // is the near side, s === -1 the far one. Drawn full size and mirrored, the
    // far ear in profile reads as a second, identical ear stuck on the wrong
    // side rather than the same ear seen from further round — so it shrinks and
    // slides back and down, tucking partway behind the skull, the same
    // treatment the far eye already gets.
    const far = profile && s < 0
    const earScale = far ? 0.56 : 1
    const setX = far ? -hrx * 0.5 : 0
    const setY = far ? hry * 0.22 : 0

    if (a.earStyle === EarStyle.floppy) {
      // A dog's ear hangs from the *top* of the skull and falls past the jaw.
      // Hung from the side it reads as earmuffs.
      // Hung from just below the top of the skull and falling past the jaw.
      // Narrow: a wide ellipse here reads as earmuffs, which is what the first
      // version looked like.
      //
      // In profile the near ear's usual attachment sits almost exactly where
      // the muzzle bulge gets pushed forward to (see sideViewDog), and the
      // muzzle paints over it since it is added after the ears. Pulling the
      // near ear back toward the eye — which is closer to where a real floppy
      // ear actually hangs from — keeps it clear of the muzzle instead.
      const nearPullback = profile && !far ? 0.24 : 0
      const ex = hx + s * hrx * (0.80 - nearPullback)
      const ey = hy - hry * 0.34 + flat * hry * 0.26
      const drop = hry * (1.30 + a.furLength * 0.40) * earScale
      out.push(layer(outer, ellipse(ex + s * hrx * 0.10 + setX, ey + drop * 0.42 + setY,
        hrx * 0.25 * earScale, drop * 0.52, s * 0.16, false)))
      // Only a sliver of the inner ear shows on a hanging ear.
      out.push(layer(inner, ellipse(ex - s * hrx * 0.02 + setX, ey + drop * 0.22 + setY,
        hrx * 0.09 * earScale, drop * 0.20, s * 0.16, false)))
      continue
    }

    const outerX = hx + s * hrx * 1.04
    const outerY = hy - hry * 0.14
    const heightScale = (a.earStyle === EarStyle.folded ? 0.62 : 1.0) * earScale
    let tipX = lerp(hx + s * hrx * 0.94, hx + s * hrx * 1.34, flat)
    let tipY = lerp(hy - hry * 1.66 * heightScale, hy - hry * 0.5, flat)
    if (a.earStyle === EarStyle.folded) {
      // Tipped forward, so the fold reads from the front.
      tipX += s * hrx * 0.22
      tipY += hry * 0.24
    }
    const innerX = hx + s * hrx * 0.14
    const innerY = hy - hry * 0.9 * heightScale

    // Shrinks every point toward the base attachment, then slides the whole
    // ear back and down — folding it partway behind the skull rather than
    // mirroring it in place at full size.
    const shrink = (px, py) => pt(lerp(outerX, px, earScale) + setX, lerp(outerY, py, earScale) + setY)
    const tipPt = shrink(tipX, tipY)
    const innerPt = shrink(innerX, innerY)

    let pts
    const notched = a.earNotch > 0 && isLeft === a.earNotchOnLeft
    if (notched) {
      pts = [
        shrink(outerX, outerY),
        shrink(lerp(outerX, tipX, 0.68), lerp(outerY, tipY, 0.68)),
        shrink(lerp(outerX, tipX, 0.76) - s * 1.7, lerp(outerY, tipY, 0.76) + 1.5 * a.earNotch),
        tipPt,
        innerPt,
      ]
    } else if (a.earStyle === EarStyle.rounded) {
      // Extra points across the tip so it reads soft, not sharp.
      pts = [
        shrink(outerX, outerY),
        shrink(lerp(outerX, tipX, 0.72) + s * 0.6, lerp(outerY, tipY, 0.72)),
        shrink(lerp(tipX, innerX, 0.22), tipY + hry * 0.06),
        shrink(lerp(tipX, innerX, 0.62), lerp(tipY, innerY, 0.28)),
        innerPt,
      ]
    } else {
      pts = [shrink(outerX, outerY), tipPt, innerPt]
    }

    out.push(layer(outer, polygon(pts)))

    const cx = pts.reduce((s2, q) => s2 + q.x, 0) / pts.length
    const cy = pts.reduce((s2, q) => s2 + q.y, 0) / pts.length
    const innerPts = pts.map(q => pt(lerp(cx, q.x, 0.5), lerp(cy, q.y, 0.54)))
    out.push(layer(inner, polygon(innerPts)))
    // A tuft of fur at the front edge of the canal.
    out.push(layer(outer, capsule(lerp(cx, innerPt.x, 0.55), lerp(cy, innerPt.y, 0.55),
      lerp(cx, tipPt.x, 0.4), lerp(cy, tipPt.y, 0.4), 0.75)))
  }
  return out
}

function face (hx, hy, hrx, hry, p, a, profile) {
  const out = []
  const open = Math.max(0, p.eyeOpen)
  const eyeY = hy - hry * (0.06 + a.snout * 0.16) + p.lookY * 0.7
  const eyeDX = hrx * (0.48 - a.snout * 0.05) // set wide, the way an animal's are
  const snout = a.snout
  // At a long snout the muzzle must break the head's outline, or the silhouette
  // stays round and the animal keeps reading as a cat.
  const muzzleY = hy + hry * (0.40 + snout * 0.62)
  const muzzleW = 0.30 + snout * 0.14

  // A long snout needs a bridge running down from between the eyes, otherwise
  // the pads just float on a flat face.
  if (snout > 0.45 && !profile) {
    out.push(layer(Part.muzzle, ellipse(hx, hy + hry * (0.18 + snout * 0.18),
      hrx * (0.20 + snout * 0.16), hry * (0.26 + snout * 0.34))))
  }

  // In profile the caller (sideView/sideViewDog) pushes a muzzle bulge forward,
  // out past the head silhouette — the whole point of a profile snout. The
  // pads, nose and mouth have to move with it, or they sit where a front-on
  // face puts them: dead centre on the head, behind the muzzle they're
  // supposed to sit on.
  const faceX = profile ? hx + hrx * (0.46 + snout * 0.22) : hx

  // Two whisker pads and a chin, not one blob. This is most of what makes a face
  // read as an animal rather than a shape.
  const padSpread = 0.23 - snout * 0.05
  out.push(layer(Part.muzzle, ellipse(faceX - hrx * padSpread, muzzleY, hrx * (muzzleW + 0.03), hry * 0.25, 0, true)))
  out.push(layer(Part.muzzle, ellipse(faceX + hrx * padSpread, muzzleY, hrx * (muzzleW + 0.03), hry * 0.25, 0, true)))
  out.push(layer(Part.muzzle, ellipse(faceX, muzzleY + hry * (0.20 + snout * 0.12),
    hrx * (0.26 + snout * 0.06), hry * (0.19 + snout * 0.09))))

  // Both eyes must land on the same subpixel phase, or one renders open and the
  // other squinting. That bug shipped once and was the first thing noticed.
  const eyeCentre = Math.round(hx * 2) / 2
  const eyeSpan = Math.round(eyeDX * 2) / 2
  const eyeRow = Math.round(eyeY * 2) / 2

  // In profile the near eye is joined by the far one, set back and smaller. A
  // strict side view shows only one eye, which reads as the other being shut
  // rather than as a head turned away.
  const sides = profile ? [1, -1] : [-1, 1]
  for (const s of sides) {
    const far = profile && s < 0
    const ex = profile
      ? eyeCentre + (far ? -eyeSpan * 0.34 : eyeSpan * 0.92)
      : eyeCentre + s * eyeSpan
    const shrink = profile ? (far ? 0.6 : 0.82) : 1.0
    const rx = hrx * 0.185 * shrink
    // A half-closed eye keeps most of its height and reads as lidded. Scaling
    // linearly with `open` collapses it into a dark smudge.
    const lidded = Math.min(1.35, Math.max(0, open))
    const ry = open < 0.12 ? 0 : hry * 0.2 * (0.42 + 0.58 * lidded) * shrink
    const tilt = profile ? 0 : s * 0.2

    if (ry < 0.4) {
      out.push(layer(Part.lid, capsule(ex - rx * 0.95, eyeRow + 0.2, ex + rx * 0.95, eyeRow - 0.2, 0.6)))
      continue
    }

    out.push(layer(Part.eyeRim, ellipse(ex, eyeRow, rx * 1.1, ry * 1.1, tilt)))
    out.push(layer(s < 0 ? Part.eyeL : Part.eyeR, ellipse(ex, eyeRow, rx, ry, tilt)))

    // Cats get a slit that opens toward round; dogs are round already.
    const dilate = far ? 0.85 : (a.species === Species.dog ? 0.9 : p.pupilDilate)
    const px = ex + p.lookX * rx * 0.46
    const py = eyeRow + p.lookY * ry * 0.32
    const pw = lerp(rx * 0.26, rx * 0.74, dilate)
    const ph = lerp(ry * 0.96, ry * 0.72, dilate)
    out.push(layer(Part.pupil, ellipse(px, py, pw, Math.max(0.5, ph), tilt)))
    if (far) continue // no catchlight on the far side
    out.push(layer(Part.shine, ellipse(px - rx * 0.34, py - ry * 0.36, rx * 0.19, ry * 0.19)))
  }

  const noseY = muzzleY - hry * 0.26
  const nw = hrx * (0.15 + snout * 0.05)
  out.push(layer(Part.nose, polygon([
    pt(faceX - nw, noseY - nw * 0.75),
    pt(faceX + nw, noseY - nw * 0.75),
    pt(faceX, noseY + nw * 0.95),
  ])))
  out.push(layer(Part.mouthLine, capsule(faceX, noseY + nw, faceX, muzzleY + hry * 0.06, 0.4)))

  if (p.mouthOpen > 0.15) {
    out.push(layer(Part.mouth, ellipse(faceX, muzzleY + hry * 0.22, hrx * 0.115,
      hry * 0.075 * p.mouthOpen * 3)))
  }
  return out
}

function collarLayers (x, y, halfWidth, a, angle = 0) {
  if (!a.collar) return []
  const dx = Math.cos(angle) * halfWidth
  const dy = Math.sin(angle) * halfWidth
  // Kept thin — at this size a wide band reads as a necktie.
  const out = [layer(Part.collar, capsule(x - dx, y - dy, x + dx, y + dy, 1))]
  out.push(layer(a.collar.hasBell ? Part.bell : Part.tag,
    ellipse(x, y + 1.9, a.collar.hasBell ? 1.3 : 1.1, a.collar.hasBell ? 1.3 : 1.4)))
  return out
}

// MARK: - Views

function frontView (p, a) {
  const L = []
  const cy = 1.5 + p.bodyY + p.crouch * 3
  const chub = a.build * 0.9 + a.furLength * 0.5
  // A long snout goes with a narrower, taller skull. Without this a dog reads as
  // a cat that happens to have floppy ears.
  const hrx = 10.4 + chub * 0.5 - a.snout * 1.9
  const hry = 9.6 + chub * 0.3 + a.snout * 1.4
  const hx = 32 + p.headX
  const hy = 21.5 + cy + p.headY + p.headLow * 9

  L.push(...tailChain(32 + 11.5, 56 + cy, 1, { ...p, tailCurve: p.tailCurve * 0.55 }, a))

  // A sitting animal is a cone: haunches spread wide at the floor, the chest
  // tapers up to a narrow neck, front legs hang in front of it.
  L.push(layer(Part.body, ellipse(32, 52.5 + cy, 11.3 + chub, 7.8 + chub * 0.5)))
  L.push(layer(Part.body, capsule(32, 31 + cy - p.headLow * 1.5, 32, 48 + cy,
    6.4 + chub * 0.45 + p.breathe * 0.4, 9.9 + chub)))
  if (a.furLength > 0.35) {
    L.push(layer(Part.body, ellipse(32, 34.5 + cy, 8.2 * a.furLength + chub * 0.4, 5.4 * a.furLength)))
  }

  const legTop = 44 + cy
  const legBot = 58 + cy
  const reach = p.frontPawReach
  for (const s of [-1, 1]) {
    const lx = 32 + s * 4.1
    const bx = lx + s * 0.6
    L.push(layer(s < 0 ? Part.legFL : Part.legFR,
      capsule(lx, legTop - reach * 1.5, bx, legBot - 1.2, 2.9, 2.5)))
    L.push(layer(Part.paw, ellipse(bx, legBot - 0.3, 3.2 + reach * 0.6, 2.3, 0, true)))
  }

  L.push(...collarLayers(32, hy + hry * 1.06, 7.4, a))
  L.push(layer(Part.head, ellipse(hx, hy, hrx, hry, p.headTilt)))
  L.push(...ears(hx, hy, hrx, hry, p, a))
  L.push(...face(hx, hy, hrx, hry, p, a, false))

  return { layers: L, meta: { headX: hx, headY: hy, headRX: hrx, headRY: hry, profile: false, view: 'front', grid: 64 } }
}

function sideView (p, a) {
  const L = []
  // A diagonal gait: each leg lifts then plants, front-near paired with
  // back-far. max(0, sin) rather than a raw sine, so a foot spends real time on
  // the ground instead of drifting through the whole cycle.
  const g = p.gait
  const swing = o => g * Math.max(0, Math.sin(p.legPhase + o))
  const nearF = p.frontLegLift + swing(0)
  const farF = swing(Math.PI)
  const nearB = p.backLegLift + swing(Math.PI)
  const farB = swing(0)
  const bob = Math.abs(Math.sin(p.legPhase)) * g * 0.9

  const st = p.stretch
  const tuck = p.tuck
  const cy = p.bodyY + p.crouch * 4 + tuck * 5 - bob
  const chub = a.build * 0.9 + a.furLength * 0.5 + tuck * 1.6
  const hrx = 8.6, hry = 8.1
  const hx = 47 + p.headX + st * 4
  const hy = 27 + cy + p.headY + p.headLow * 10 + st * 6

  // The tail leaves from the top of the rump, not from inside the body.
  //
  // Two bugs lived here. The origin sat well within the body capsule, so the body
  // painted over most of the tail; and because the chain runs with dir = -1, a
  // *positive* `tailBase` swings the tail downward, straight into the back legs.
  // The result was that every walking cat had an invisible tail. Poses still say
  // "more tailBase means more lift", so the sign is flipped here rather than in
  // fifteen animations.
  //
  // (A dark crescent that used to show up on the belly in loaf/sleep looked at
  // first like a tail problem — it was not; it lived in raster.js, where two
  // overlapping body shapes handed off material coordinates at their seam. See
  // the comment there.)
  L.push(...tailChain(15.5 - st * 3, 32 + cy + st * 2, -1,
    { ...p, tailBase: -(0.30 + p.tailBase * 0.85) }, a))

  // Far legs first — the painter shades them down so the near pair reads in
  // front without needing an outline between them.
  const legBot = 58 + cy * 0.3
  const hideLegs = tuck > 0.5
  L.push(layer(Part.legFar, capsule(40 + st * 4, 43 + cy, 41 - farF * 3 + st * 7, legBot - farF * 4, 2.6, 2.3), null, hideLegs))
  L.push(layer(Part.legFar, capsule(24, 45 + cy, 22 + farB * 3 - st * 3, legBot - farB * 4, 2.7, 2.3), null, hideLegs))

  L.push(layer(Part.body, capsule(23 - st * 3, 39 + cy + st * 3, 42 + st * 4, 36.5 + cy, 10.4 + chub, 9.4 + chub)))
  L.push(layer(Part.body, ellipse(24 - st * 2, 42 + cy + st * 1.5, 8.6 + chub, 8.2, 0, true)))

  L.push(layer(Part.legFR, capsule(42 + st * 3, 43 + cy, 43.4 + nearF * 3.5 + st * 8, legBot - nearF * 5, 2.9, 2.4), null, hideLegs))
  L.push(layer(Part.paw, ellipse(43.4 + nearF * 3.5 + st * 8, legBot - nearF * 5, 3.2, 2.2, 0, true), null, hideLegs))
  L.push(layer(Part.legBR, capsule(25, 47 + cy, 26.5 - nearB * 3.5 - st * 2, legBot - nearB * 5, 3.0, 2.4), null, hideLegs))
  L.push(layer(Part.paw, ellipse(26.5 - nearB * 3.5 - st * 2, legBot - nearB * 5, 3.2, 2.2, 0, true), null, hideLegs))

  L.push(...collarLayers(hx - hrx * 0.5, hy + hry * 1.15, 4.2, a, 1.15))
  L.push(layer(Part.head, ellipse(hx, hy, hrx, hry, p.headTilt)))
  // The muzzle pushes forward in profile, further for a long snout.
  L.push(layer(Part.muzzle, ellipse(hx + hrx * (0.62 + a.snout * 0.22), hy + hry * 0.36,
    hrx * (0.4 + a.snout * 0.16), hry * 0.35, 0, true)))
  L.push(...face(hx, hy, hrx, hry, p, a, true))
  // After the muzzle, not before: a pointed ear sits above it with no overlap
  // either way, but a floppy ear's near-side attachment lands almost exactly
  // where the muzzle bulge pushes forward to, and drawn first it vanished
  // underneath. Order settles what position tuning alone could not.
  L.push(...ears(hx, hy, hrx, hry, p, a, true))

  return { layers: L, meta: { headX: hx, headY: hy, headRX: hrx, headRY: hry, profile: true, view: 'side', grid: 64 } }
}

function curlView (p, a) {
  const L = []
  const cy = p.bodyY
  const chub = a.build * 0.9 + a.furLength * 0.5
  const cx = 30
  const bodyY = 48 + cy // a sleeping animal sits low

  // The tail wraps around the front of the curl — the whole point.
  L.push(...tailChain(cx + 15, bodyY + 3, -1,
    { ...p, tailBase: -0.9, tailCurve: 0.46, tailWave: 0 }, a))

  L.push(layer(Part.body, ellipse(cx, bodyY, 15.5 + chub, 9.4 + chub * 0.4, 0, true)))
  L.push(layer(Part.body, ellipse(cx + 2, bodyY - 3.2, 11.5 + chub, 7.2, 0, true)))

  const hrx = 8.0, hry = 7.4
  const hx = cx + 13.5
  const hy = bodyY - 4.5 + p.headY
  L.push(layer(Part.paw, ellipse(hx - 3.5, hy + hry * 1.02, 4.6, 2.3, 0, true)))
  L.push(layer(Part.head, ellipse(hx, hy, hrx, hry, -0.25)))

  L.push(...ears(hx, hy, hrx, hry,
    { ...p, earL: Math.max(p.earL, 0.25), earR: Math.max(p.earR, 0.15) }, a))
  L.push(...face(hx, hy, hrx, hry, { ...p, eyeOpen: Math.min(p.eyeOpen, 0.12) }, a, false))

  return { layers: L, meta: { headX: hx, headY: hy, headRX: hrx, headRY: hry, profile: false, view: 'curl', grid: 64 } }
}

// MARK: - Dog views
//
// Authored against the same 64-space floor (y ≈ 58, y increasing downward) so
// dogs and cats can share a stage and stand on the same ground.

/// Dogs are built long-legged. `stance` is how much clearance the body has over
/// the floor, and it is the single number that most decides whether a silhouette
/// reads as a dog or a cat: a dachshund and a lab differ mostly here.
function dogStance (a) {
  // size 0.8 (dachshund) → short; 1.3 (lab) → tall. Build thickens rather than
  // lengthens, so a stocky dog does not become a tall one.
  const legs = 6.0 + (a.size - 0.8) * 14.0
  return {
    legs: Math.max(2.5, legs),
    // These are capsule *radii*, so half the depth of the animal. Passing the
    // full chest depth here made the body a barrel that swallowed the legs, and
    // every dog came out looking like a ferret on stumps.
    chest: 5.4 + a.build * 0.8 + a.furLength * 0.5,
    waist: 4.3 + a.build * 0.7 + a.furLength * 0.4,
    long: 1.0 + Math.max(0, 1.05 - a.size) * 1.5, // low dogs are proportionally longer
  }
}

/// Back legs bend at the hock — the backwards-facing joint that, more than
/// anything else in the outline, says "dog" rather than "cat on stilts". Emitted
/// as two capsules sharing one 0..1 span so sock markings still run foot-upward.
function hockLeg (part, hipX, hipY, footX, footY, thickness, hidden) {
  const hockX = hipX + (footX - hipX) * -0.35
  const hockY = hipY + (footY - hipY) * 0.58
  return [
    layer(part, capsule(hipX, hipY, hockX, hockY, thickness, thickness * 0.72), [0, 0.55], hidden),
    layer(part, capsule(hockX, hockY, footX, footY, thickness * 0.72, thickness * 0.6), [0.55, 1], hidden),
  ]
}

function frontViewDog (p, a) {
  const L = []
  const s = dogStance(a)
  const cy = 1.5 + p.bodyY + p.crouch * 3
  const floor = 58 + cy
  const chub = a.build * 0.9 + a.furLength * 0.5

  const hrx = 8.4 + chub * 0.45 - a.snout * 1.2
  const hry = 8.0 + chub * 0.28 + a.snout * 1.1

  // Everything is measured from the chest outward, not from the top of the
  // canvas. Placing the head at a fixed height instead left a twenty-unit
  // capsule between skull and shoulders, and the animal read as a meerkat.
  const chestY = floor - 11.5 - s.legs * 0.20
  const chestRY = 7.2 + chub * 0.45 + p.breathe * 0.3
  const neck = 3.2 + s.legs * 0.10 // a taller dog carries a longer neck
  const hx = 32 + p.headX
  const hy = chestY - chestRY - neck - hry * 0.35 + p.headY + p.headLow * 10

  // Curled beside the haunches rather than stretched out behind. A cat's long
  // trailing tail on a sitting dog was one of the tells that it wasn't a dog.
  L.push(...tailChain(32 + 9.5, floor - 2.5, 1,
    { ...p, tailBase: -0.15, tailCurve: p.tailCurve * 0.35 }, a))

  // Haunches spread on the floor, then a chest wider than it is tall — broad
  // shoulders are what a dog presents head-on.
  L.push(layer(Part.body, ellipse(32, floor - 4.6, 11.4 + chub, 6.6 + chub * 0.5)))
  L.push(layer(Part.body, ellipse(32, chestY, 9.4 + chub * 0.7, chestRY)))
  L.push(layer(Part.body, capsule(32, hy + hry * 0.62, 32, chestY - chestRY * 0.35,
    4.4 + chub * 0.35, 5.8 + chub * 0.4)))

  // Front legs: long, straight and close together, which is how a dog sits.
  const legTop = chestY + 2.0
  for (const side of [-1, 1]) {
    const lx = 32 + side * 3.6
    L.push(layer(side < 0 ? Part.legFL : Part.legFR,
      capsule(lx, legTop - p.frontPawReach * 1.5, lx + side * 0.4, floor - 1.4, 2.4, 2.0)))
    L.push(layer(Part.paw, ellipse(lx + side * 0.4, floor - 0.4,
      3.0 + p.frontPawReach * 0.6, 2.2, 0, true)))
  }

  L.push(...collarLayers(32, hy + hry * 1.15, 6.4, a))
  L.push(layer(Part.head, ellipse(hx, hy, hrx, hry, p.headTilt)))
  L.push(...ears(hx, hy, hrx, hry, p, a))
  L.push(...face(hx, hy, hrx, hry, p, a, false))

  return { layers: L, meta: { headX: hx, headY: hy, headRX: hrx, headRY: hry, profile: false, view: 'front', grid: 64 } }
}

function sideViewDog (p, a) {
  const L = []
  const s = dogStance(a)
  const g = p.gait
  const swing = o => g * Math.max(0, Math.sin(p.legPhase + o))
  const nearF = p.frontLegLift + swing(0)
  const farF = swing(Math.PI)
  const nearB = p.backLegLift + swing(Math.PI)
  const farB = swing(0)
  const bob = Math.abs(Math.sin(p.legPhase)) * g * 0.8

  const st = p.stretch
  const tuck = p.tuck
  const cy = p.bodyY + p.crouch * 4 + tuck * 4 - bob
  const chub = a.build * 0.9 + a.furLength * 0.5 + tuck * 1.6
  const floor = 58

  // Standing height. When lying down (tuck) the body drops to the floor and the
  // legs fold away.
  const clear = tuck > 0.5 ? 2.0 : s.legs
  const hipX = 21 - s.long * 1.6 - st * 3
  const shoulderX = 41 + st * 4
  // The topline slopes down from the withers to the croup.
  const shoulderY = floor - clear - s.chest + cy
  const hipY = shoulderY + 1.9

  const hrx = 7.6, hry = 7.2
  const hx = shoulderX + 8.0 + p.headX + st * 4
  // Held well above the withers on a long neck — the shape that most separates a
  // standing dog from a standing cat.
  const hy = shoulderY - 10.5 + p.headY + p.headLow * 13 + st * 6

  // Same lift as the cat: negative raises, and the origin sits on top of the croup
  // so the tail is not buried in the body.
  L.push(...tailChain(hipX - 1.0, hipY - s.waist * 0.72, -1,
    { ...p, tailBase: -(0.45 + p.tailBase * 0.85) }, a))

  const hideLegs = tuck > 0.5
  // Far side first — the painter shades it down so the near pair reads in front.
  L.push(layer(Part.legFar, capsule(shoulderX - 1.5, shoulderY + s.chest * 0.6,
    shoulderX - 2.5 - farF * 3 + st * 7, floor - farF * 4, 2.5, 2.1), null, hideLegs))
  L.push(...hockLeg(Part.legFar, hipX + 1.5, hipY + s.waist * 0.55,
    hipX + 0.5 + farB * 3 - st * 3, floor - farB * 4, 2.6, hideLegs))

  // Deep chest at the front, tucked waist behind it — the classic dog outline.
  L.push(layer(Part.body, capsule(hipX, hipY, shoulderX, shoulderY,
    s.waist + chub, s.chest + chub)))
  L.push(layer(Part.body, ellipse(shoulderX - 1.5, shoulderY + 1.6,
    6.6 + chub * 0.6, s.chest * 0.92 + chub * 0.5, 0, false)))
  // The neck, angled up out of the shoulders. Cats do not need one drawn; on a
  // dog its absence is the first thing that looks wrong.
  L.push(layer(Part.body, capsule(shoulderX - 0.5, shoulderY - s.chest * 0.30,
    hx - hrx * 0.50, hy + hry * 0.80, 4.4 + chub * 0.3, 3.4 + chub * 0.25)))

  L.push(layer(Part.legFR, capsule(shoulderX + 0.8, shoulderY + s.chest * 0.6,
    shoulderX + 1.6 + nearF * 3.5 + st * 8, floor - nearF * 5, 2.8, 2.3), null, hideLegs))
  L.push(layer(Part.paw, ellipse(shoulderX + 1.6 + nearF * 3.5 + st * 8, floor - nearF * 5,
    3.1, 2.1, 0, true), null, hideLegs))
  L.push(...hockLeg(Part.legBR, hipX + 3.0, hipY + s.waist * 0.55,
    hipX + 2.0 - nearB * 3.5 - st * 2, floor - nearB * 5, 2.9, hideLegs))
  L.push(layer(Part.paw, ellipse(hipX + 2.0 - nearB * 3.5 - st * 2, floor - nearB * 5,
    3.1, 2.1, 0, true), null, hideLegs))

  L.push(...collarLayers(hx - hrx * 0.62, hy + hry * 1.05, 4.0, a, 1.05))
  L.push(layer(Part.head, ellipse(hx, hy, hrx, hry, p.headTilt)))
  // A dog's muzzle is long and squared off, and it carries most of the profile.
  L.push(layer(Part.muzzle, ellipse(hx + hrx * (0.62 + a.snout * 0.30), hy + hry * 0.30,
    hrx * (0.40 + a.snout * 0.24), hry * 0.31, 0, true)))
  L.push(...face(hx, hy, hrx, hry, p, a, true))
  // After the muzzle: a floppy ear's near-side attachment lands almost exactly
  // where the muzzle bulge pushes forward to, and drawn first it vanished
  // underneath it entirely. See sideView for the cat equivalent.
  L.push(...ears(hx, hy, hrx, hry, p, a, true))

  return { layers: L, meta: { headX: hx, headY: hy, headRX: hrx, headRY: hry, profile: true, view: 'side', grid: 64 } }
}

function curlViewDog (p, a) {
  const L = []
  const s = dogStance(a)
  const cy = p.bodyY
  const chub = a.build * 0.9 + a.furLength * 0.5
  const cx = 29
  const bodyY = 50 + cy

  // A sleeping dog flops rather than making a neat cat spiral, and the tail
  // trails behind instead of wrapping the nose.
  L.push(...tailChain(cx - 12, bodyY + 1, -1,
    { ...p, tailBase: 0.15, tailCurve: 0.28, tailWave: 0 }, a))

  L.push(layer(Part.body, ellipse(cx, bodyY, 16.5 + s.long + chub, 7.4 + chub * 0.4, 0, true)))
  L.push(layer(Part.body, ellipse(cx + 4, bodyY - 2.6, 11.0 + chub, 5.8, 0, true)))
  // Folded legs showing along the near side.
  L.push(layer(Part.paw, ellipse(cx - 3, bodyY + 5.4, 4.4, 2.0, 0, true)))
  L.push(layer(Part.paw, ellipse(cx + 7, bodyY + 5.2, 4.2, 2.0, 0, true)))

  const hrx = 7.6, hry = 7.0
  const hx = cx + 14.5
  const hy = bodyY - 3.2 + p.headY
  L.push(layer(Part.head, ellipse(hx, hy, hrx, hry, -0.18)))
  // Muzzle laid flat on the floor.
  L.push(layer(Part.muzzle, ellipse(hx + hrx * (0.70 + a.snout * 0.34), hy + hry * 0.46,
    hrx * (0.46 + a.snout * 0.3), hry * 0.30, 0, true)))

  L.push(...ears(hx, hy, hrx, hry,
    { ...p, earL: Math.max(p.earL, 0.3), earR: Math.max(p.earR, 0.2) }, a))
  L.push(...face(hx, hy, hrx, hry, { ...p, eyeOpen: Math.min(p.eyeOpen, 0.12) }, a, false))

  return { layers: L, meta: { headX: hx, headY: hy, headRX: hrx, headRY: hry, profile: false, view: 'curl', grid: 64 } }
}

// MARK: - Transforms

function mirror (l) {
  const s = { ...l.shape }
  const mx = x => BASE - x
  if (s.kind === 0) { s.x1 = mx(s.x1); s.rot = -s.rot }
  else if (s.kind === 1) { s.x1 = mx(s.x1); s.x2 = mx(s.x2) }
  else s.points = s.points.map(q => pt(mx(q.x), q.y))

  // Left/right parts swap identity so markings stay on the correct side.
  const swap = {
    [Part.earL]: Part.earR, [Part.earR]: Part.earL,
    [Part.earInL]: Part.earInR, [Part.earInR]: Part.earInL,
    [Part.eyeL]: Part.eyeR, [Part.eyeR]: Part.eyeL,
    [Part.legFL]: Part.legFR, [Part.legFR]: Part.legFL,
  }
  const part = swap[l.part] !== undefined ? swap[l.part] : l.part
  return layer(part, s, l.uRange, l.hidden)
}

function scale (l, k) {
  const s = { ...l.shape }
  if (s.kind === 0) { s.x1 *= k; s.y1 *= k; s.r1 *= k; s.r2 *= k }
  else if (s.kind === 1) { s.x1 *= k; s.y1 *= k; s.x2 *= k; s.y2 *= k; s.r1 *= k; s.r2 *= k }
  else s.points = s.points.map(q => pt(q.x * k, q.y * k))
  return layer(l.part, s, l.uRange, l.hidden)
}
