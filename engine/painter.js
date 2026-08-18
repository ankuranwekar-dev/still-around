// Turns a region map into pixels.
//
// Everything here is continuous — ramps are interpolated rather than stepped,
// the silhouette comes from coverage rather than a hard mask, and material
// boundaries are softened afterwards so markings feather like fur instead of
// ending on a clean mathematical curve.
//
// Output is straight (non-premultiplied) RGBA, because that is what a canvas
// ImageData wants. The native version premultiplies for CoreGraphics; getting
// this backwards shows up as a dark halo around the whole animal.

import { Part, seamMask, silhouetteDepth } from './raster.js'
import { Material } from './coat.js'
import { fbm } from './noise.js'

/// Materials that should stay flat. A shaded three-pixel pupil is mud.
function flatStep (m) {
  if (m === Material.pupil) return 1
  if (m === Material.shine) return 0
  if (m === Material.eyeRim) return 1
  return null
}

/// Small features whose edges would smear away if softened.
function isCrisp (m) {
  return m === Material.pupil || m === Material.shine || m === Material.eyeRim ||
    m === Material.nose || m === Material.iris || m === Material.mouth
}

const SOFT_SEAMS = [
  [Part.earL, Part.head], [Part.earR, Part.head], [Part.head, Part.body],
]

/// Limbs need a firm crease — white legs against a white chest have no colour
/// difference to separate them.
const FIRM_SEAMS = [
  [Part.body, Part.legFL], [Part.body, Part.legFR], [Part.body, Part.legBR],
  [Part.body, Part.legFar], [Part.body, Part.tail], [Part.legFL, Part.paw],
  [Part.legFR, Part.paw], [Part.legBR, Part.paw], [Part.legFL, Part.legFR],
]

function smoothstep (a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function sampleRamp (ramp, t) {
  const last = ramp.length - 1
  const p = Math.min(Math.max(t, 0), last)
  const i = Math.floor(p)
  const j = Math.min(last, i + 1)
  const f = p - i
  const a = ramp[i], b = ramp[j]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

const SHADED_PARTS = new Set([
  Part.body, Part.head, Part.muzzle, Part.tail, Part.earL, Part.earR,
  Part.legFL, Part.legFR, Part.legBL, Part.legBR, Part.legFar, Part.paw,
])

/// Returns { rgba: Uint8ClampedArray, size } ready for `new ImageData(rgba, size, size)`.
export function paint (map, coat, meta) {
  const size = map.size
  const n = size * size
  const rgba = new Uint8ClampedArray(n * 4)
  const materials = new Uint8Array(n).fill(255)

  const seamSoft = seamMask(map, SOFT_SEAMS)
  const seamFirm = seamMask(map, FIRM_SEAMS)
  const depthField = silhouetteDepth(map, Math.max(2, Math.floor(size / 44)))

  // Vertical extent, so the top-light term frames to the pose rather than to the
  // canvas.
  let top = size, bottom = 0
  for (let i = 0; i < n; i++) {
    if (map.part[i] === Part.EMPTY) continue
    const y = (i / size) | 0
    if (y < top) top = y
    if (y > bottom) bottom = y
  }
  const height = Math.max(1, bottom - top)
  const outline = coat.outline

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const part = map.part[i]
      if (part === Part.EMPTY) continue

      let material
      if (SHADED_PARTS.has(part)) {
        // Wobble the coordinates the coat sees, so marking edges follow fur
        // rather than a smooth curve.
        const nu = fbm(x * 0.19, y * 0.19) - 0.5
        const nv = fbm(x * 0.19 + 31.7, y * 0.19 + 12.3) - 0.5
        material = coat.material(part, map.u[i] + nu * 0.05, map.v[i] + nv * 0.05, meta.view)
      } else {
        material = coat.material(part, map.u[i], map.v[i], meta.view)
      }
      materials[i] = material

      const ramp = coat.ramp(material)
      const last = ramp.length - 1
      const flat = flatStep(material)
      let t

      if (flat !== null) {
        t = Math.min(flat, last)
      } else {
        const topTerm = 1 - (y - top) / height
        // Three terms, weighted away from per-shape roundness: a little form on
        // each limb, the body's overall depth, and a top light. Leaning on the
        // first alone turns every primitive into its own lit cylinder.
        const round = Math.pow(map.edge[i], 0.72)
        const depth = smoothstep(0.15, 0.85, depthField[i])
        let lum = round * 0.26 + depth * 0.32 + topTerm * 0.42
        if (part === Part.legFar) lum -= 0.2 // far legs sit in shadow
        lum += (fbm(x * 0.45 + 60.1, y * 0.45 + 7.4) - 0.5) * 0.02

        t = (1 - lum) * last
        if (seamSoft[i]) t += 0.25
        if (seamFirm[i]) t += 0.38
      }

      let c = sampleRamp(ramp, t)

      // Tint the outer silhouette toward the outline colour, weighted to the
      // underside. Keyed off the silhouette, never off joins.
      if (flat === null) {
        const rim = 1 - smoothstep(0.02, 0.42, depthField[i])
        if (rim > 0) {
          const w = (0.2 + ((y - top) / height) * 0.34) * rim
          c = [
            c[0] + (outline[0] - c[0]) * w,
            c[1] + (outline[1] - c[1]) * w,
            c[2] + (outline[2] - c[2]) * w,
          ]
        }
      }

      const o = i * 4
      rgba[o] = c[0] * 255
      rgba[o + 1] = c[1] * 255
      rgba[o + 2] = c[2] * 255
      rgba[o + 3] = Math.min(1, map.cover[i]) * 255
    }
  }

  softenMaterialEdges(rgba, materials, size)
  drawWhiskers(rgba, size, meta, coat)

  return { rgba, size }
}

/// Blur across material boundaries only.
///
/// The coat decides each pixel's material with a hard yes or no, which leaves a
/// crisp line where ginger meets white. Real markings feather.
function softenMaterialEdges (buf, materials, size) {
  const copy = buf.slice()
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x
      const m = materials[i]
      if (m === 255 || isCrisp(m)) continue

      const neighbours = [i - 1, i + 1, i - size, i + size]
      let differing = false
      for (const k of neighbours) {
        const nm = materials[k]
        if (nm !== 255 && nm !== m && !isCrisp(nm)) { differing = true; break }
      }
      if (!differing) continue

      let weight = 2
      const acc = [copy[i * 4] * 2, copy[i * 4 + 1] * 2, copy[i * 4 + 2] * 2, copy[i * 4 + 3] * 2]
      for (const k of neighbours) {
        if (materials[k] === 255) continue
        for (let c = 0; c < 4; c++) acc[c] += copy[k * 4 + c]
        weight++
      }
      for (let c = 0; c < 4; c++) buf[i * 4 + c] = acc[c] / weight
    }
  }
}

// MARK: - Whiskers

/// Bilinear splat with straight-alpha source-over, so a whisker is a smooth hair
/// rather than a staircase.
function blend (buf, size, x, y, c, alpha) {
  const fx = Math.floor(x), fy = Math.floor(y)
  const dx = x - fx, dy = y - fy
  for (let oy = 0; oy <= 1; oy++) {
    for (let ox = 0; ox <= 1; ox++) {
      const px = fx + ox, py = fy + oy
      if (px < 0 || py < 0 || px >= size || py >= size) continue
      const w = (ox === 1 ? dx : 1 - dx) * (oy === 1 ? dy : 1 - dy) * alpha
      if (w <= 0) continue
      const o = (py * size + px) * 4
      const a = buf[o + 3] / 255
      const outA = w + a * (1 - w)
      if (outA <= 0) continue
      for (let k = 0; k < 3; k++) {
        const existing = buf[o + k] / 255
        // Straight alpha: weight the existing colour by its own coverage.
        buf[o + k] = ((c[k] * w + existing * a * (1 - w)) / outA) * 255
      }
      buf[o + 3] = outA * 255
    }
  }
}

function drawWhiskers (buf, size, meta, coat) {
  const rx = meta.headRX, ry = meta.headRY
  if (!(rx > 0)) return
  const white = coat.ramp(Material.white)[0]
  const alpha = coat.isDog ? 0.10 : 0.32
  const sides = meta.profile ? [1] : [-1, 1]

  for (const s of sides) {
    // Rooted in the whisker pads, where they actually grow from.
    const ox = meta.headX + s * rx * 0.34
    const oy = meta.headY + ry * 0.46
    for (let k = -1; k <= 1; k++) {
      const len = rx * (0.95 - Math.abs(k) * 0.14)
      const x1 = ox, y1 = oy + k * (ry * 0.09)
      const x2 = ox + s * len, y2 = oy + k * (ry * 0.24) - ry * 0.13
      const steps = Math.floor(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 3) + 1
      for (let step = 0; step <= steps; step++) {
        const t = step / steps
        blend(buf, size, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, white, alpha * (1 - t * 0.72))
      }
    }
  }
}
