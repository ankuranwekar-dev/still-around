// Raster core for the pet rig.
//
// Poses are built out of a handful of primitive shapes. Rasterising them
// produces a *region map*: for every pixel we record which body part owns it,
// where inside that part it sits (u along the part's axis, v across it), and how
// far it is from the part's own silhouette.
//
// Coats then paint that map, which is what lets markings stay glued to the right
// body part no matter how the pose moves. There are no sprite sheets anywhere in
// this project — every frame is drawn from numbers.

export const Part = {
  body: 0, head: 1, muzzle: 2,
  earL: 3, earR: 4, earInL: 5, earInR: 6,
  eyeL: 7, eyeR: 8, eyeRim: 9, pupil: 10, shine: 11,
  nose: 12, mouth: 13, mouthLine: 14, lip: 15, lid: 16,
  legFL: 17, legFR: 18, legBL: 19, legBR: 20, legFar: 21, paw: 22,
  tail: 23, collar: 24, tag: 25, bell: 26,
  EMPTY: 255,
}

const KIND = { ellipse: 0, capsule: 1, polygon: 2 }
export { KIND }

export function ellipse (x, y, rx, ry, rot = 0, axisIsX = false) {
  return { kind: KIND.ellipse, x1: x, y1: y, x2: 0, y2: 0, r1: rx, r2: ry, rot, axisIsX, points: null }
}

export function capsule (x1, y1, x2, y2, r1, r2 = null) {
  return { kind: KIND.capsule, x1, y1, x2, y2, r1, r2: r2 === null ? r1 : r2, rot: 0, axisIsX: false, points: null }
}

export function polygon (points) {
  return { kind: KIND.polygon, x1: 0, y1: 0, x2: 0, y2: 0, r1: 0, r2: 0, rot: 0, axisIsX: false, points }
}

/// `uRange` remaps this layer's local u into a wider span. A tail built from
/// eight capsules still exposes one continuous 0..1 from base to tip, which is
/// what tail banding needs.
export function layer (part, shape, uRange = null, hidden = false) {
  return { part, shape, uRange, hidden, bounds: boundsOf(shape) }
}

// MARK: - Hit testing
// Each returns {u, v, edge} or null.

export function hit (s, px, py) {
  if (s.kind === KIND.ellipse) return hitEllipse(s, px, py)
  if (s.kind === KIND.capsule) return hitCapsule(s, px, py)
  return hitPolygon(s, px, py)
}

function hitEllipse (s, px, py) {
  let dx = px - s.x1
  let dy = py - s.y1
  if (s.rot !== 0) {
    const c = Math.cos(-s.rot), si = Math.sin(-s.rot)
    const nx = dx * c - dy * si
    dy = dx * si + dy * c
    dx = nx
  }
  const nx = dx / s.r1
  const ny = dy / s.r2
  const d2 = nx * nx + ny * ny
  if (d2 > 1) return null
  const along = s.axisIsX ? nx : ny
  const across = s.axisIsX ? ny : nx
  return { u: (along + 1) / 2, v: across, edge: 1 - Math.sqrt(d2) }
}

function hitCapsule (s, px, py) {
  const dx = s.x2 - s.x1
  const dy = s.y2 - s.y1
  const len2 = Math.max(dx * dx + dy * dy, 1e-6)
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / len2
  t = Math.min(Math.max(t, 0), 1)
  const cx = s.x1 + dx * t
  const cy = s.y1 + dy * t
  const r = s.r1 + (s.r2 - s.r1) * t
  const ox = px - cx
  const oy = py - cy
  const dist = Math.sqrt(ox * ox + oy * oy)
  if (dist > r) return null
  // Signed side of the axis, so coats can tell belly from back.
  const len = Math.sqrt(len2)
  const cross = (dx * oy - dy * ox) / len
  return { u: t, v: r > 0 ? cross / r : 0, edge: r > 0 ? 1 - dist / r : 1 }
}

function hitPolygon (s, px, py) {
  const pts = s.points
  if (!pts || pts.length < 3) return null
  let inside = false
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  let nearest = Infinity

  let j = pts.length - 1
  for (let i = 0; i < pts.length; i++) {
    const pi = pts[i], pj = pts[j]
    if (pi.x < minX) minX = pi.x
    if (pi.x > maxX) maxX = pi.x
    if (pi.y < minY) minY = pi.y
    if (pi.y > maxY) maxY = pi.y
    if ((pi.y > py) !== (pj.y > py) &&
        px < ((pj.x - pi.x) * (py - pi.y)) / (pj.y - pi.y) + pi.x) {
      inside = !inside
    }
    const d = distanceToSegment(px, py, pi, pj)
    if (d < nearest) nearest = d
    j = i
  }
  if (!inside) return null
  const w = Math.max(maxX - minX, 1e-6)
  const h = Math.max(maxY - minY, 1e-6)
  const span = Math.max(w, h) / 2
  return { u: (py - minY) / h, v: ((px - minX) / w) * 2 - 1, edge: Math.min(1, nearest / span) }
}

function distanceToSegment (px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = Math.max(dx * dx + dy * dy, 1e-6)
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2
  t = Math.min(Math.max(t, 0), 1)
  const ex = px - (a.x + dx * t), ey = py - (a.y + dy * t)
  return Math.sqrt(ex * ex + ey * ey)
}

// MARK: - Bounds

/// Most layers — eyes, nose, ear tufts — cover a tiny slice of the canvas.
/// Culling by these before hit-testing is the difference between a render taking
/// 20ms and 200ms, and in the browser that difference is the whole experience.
export function boundsOf (s) {
  if (s.kind === KIND.ellipse) {
    const c = Math.cos(s.rot), si = Math.sin(s.rot)
    const xc = s.r1 * c, xs = s.r2 * si
    const yc = s.r2 * c, ys = s.r1 * si
    const hw = Math.sqrt(xc * xc + xs * xs)
    const hh = Math.sqrt(ys * ys + yc * yc)
    return { x0: s.x1 - hw, y0: s.y1 - hh, x1: s.x1 + hw, y1: s.y1 + hh }
  }
  if (s.kind === KIND.capsule) {
    const r = Math.max(s.r1, s.r2)
    return {
      x0: Math.min(s.x1, s.x2) - r, y0: Math.min(s.y1, s.y2) - r,
      x1: Math.max(s.x1, s.x2) + r, y1: Math.max(s.y1, s.y2) + r,
    }
  }
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const p of s.points) {
    if (p.x < b.x0) b.x0 = p.x
    if (p.x > b.x1) b.x1 = p.x
    if (p.y < b.y0) b.y0 = p.y
    if (p.y > b.y1) b.y1 = p.y
  }
  return b
}

// MARK: - Rasterise

/// Supersamples per axis. Three gives ten alpha levels at the silhouette, which
/// is enough for a smooth edge once the sprite is drawn down.
export const SAMPLES_PER_AXIS = 3

/// Layers are painted back to front; the last one containing a sample wins.
/// Partial coverage becomes alpha rather than a hard in/out decision — that
/// antialiased edge is most of what separates a smooth render from a pixel-art
/// one, and it is why this project draws its own pixels instead of using SVG.
export function rasterize (layers, size) {
  const n = size * size
  const map = {
    size,
    part: new Uint8Array(n).fill(Part.EMPTY),
    u: new Float32Array(n),
    v: new Float32Array(n),
    edge: new Float32Array(n),
    cover: new Float32Array(n),
  }

  const live = layers.filter(l => !l.hidden)
  if (live.length === 0) return map

  const ss = SAMPLES_PER_AXIS
  const step = 1 / ss
  const offset = step / 2
  const sampleCount = ss * ss

  const votes = new Int32Array(32)
  const row = []
  const near = []

  for (let py = 0; py < size; py++) {
    const fy = py
    row.length = 0
    for (let i = 0; i < live.length; i++) {
      const b = live[i].bounds
      if (b.y0 < fy + 1 && b.y1 >= fy) row.push(i)
    }
    if (row.length === 0) continue

    for (let px = 0; px < size; px++) {
      const fx = px
      near.length = 0
      for (let k = 0; k < row.length; k++) {
        const b = live[row[k]].bounds
        if (b.x0 < fx + 1 && b.x1 >= fx) near.push(row[k])
      }
      if (near.length === 0) continue

      votes.fill(0)
      let filled = 0

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = fx + offset + sx * step
          const y = fy + offset + sy * step
          let top = -1
          for (let k = 0; k < near.length; k++) {
            if (hit(live[near[k]].shape, x, y)) top = near[k]
          }
          if (top < 0) continue
          filled++
          votes[live[top].part]++
        }
      }

      const idx = py * size + px
      map.cover[idx] = filled / sampleCount
      if (filled === 0) continue

      let winner = 0
      let best = -1
      for (let p = 0; p < votes.length; p++) {
        if (votes[p] > best) { best = votes[p]; winner = p }
      }

      // Read u/v/edge from the winning part. Sample at the pixel centre.
      //
      // Several body parts (the torso, the rump) are drawn as two or three
      // overlapping shapes sharing one Part, so their footprints handle a
      // continuous stretch of the animal between them. Naively taking the
      // *topmost* shape's hit is wrong right at the seam between two such
      // shapes: a pixel there can sit deep inside shape A but only a hair
      // inside shape B's own edge, and each shape's u/v is local to itself, so
      // preferring B (because it happens to be drawn later) hands the coat a
      // near-boundary coordinate for a pixel that is nowhere near *A*'s
      // boundary. On a high white-chest tuxedo this showed up as a dark
      // crescent floating in the middle of an otherwise-white belly — the
      // rump ellipse's edge slicing across the torso capsule's interior.
      // Picking the candidate with the highest `edge` (most confidently
      // interior to *its own* shape) instead means the more solid, more
      // contiguous shape wins the handoff, which is what keeps the material
      // continuous across the seam.
      let found = null
      let bestEdge = -Infinity
      for (let k = near.length - 1; k >= 0; k--) {
        const l = live[near[k]]
        if (l.part !== winner) continue
        const h = hit(l.shape, fx + 0.5, fy + 0.5)
        if (h && h.edge > bestEdge) {
          if (l.uRange) h.u = l.uRange[0] + h.u * (l.uRange[1] - l.uRange[0])
          bestEdge = h.edge
          found = h
        }
      }
      // Thin limbs and ear tips can miss every shape's exact centre; fall back
      // to whichever supersample lands inside, topmost first, same as before.
      if (!found) {
        outer:
        for (let k = near.length - 1; k >= 0; k--) {
          const l = live[near[k]]
          if (l.part !== winner) continue
          for (let sy = 0; sy < ss; sy++) {
            for (let sx = 0; sx < ss; sx++) {
              const h = hit(l.shape, fx + offset + sx * step, fy + offset + sy * step)
              if (h) {
                if (l.uRange) h.u = l.uRange[0] + h.u * (l.uRange[1] - l.uRange[0])
                found = h
                break outer
              }
            }
          }
        }
      }

      map.part[idx] = winner
      map.u[idx] = found ? found.u : 0.5
      map.v[idx] = found ? found.v : 0
      map.edge[idx] = found ? found.edge : 0.5
    }
  }

  return map
}

/// True where two named parts meet — used for soft creases.
export function seamMask (map, pairs) {
  const size = map.size
  const mask = new Uint8Array(size * size)
  const wanted = new Set()
  for (const [a, b] of pairs) {
    wanted.add((a << 8) | b)
    wanted.add((b << 8) | a)
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const p = map.part[i]
      if (p === Part.EMPTY) continue
      if (x < size - 1) {
        const r = map.part[i + 1]
        if (r !== Part.EMPTY && r !== p && wanted.has((p << 8) | r)) { mask[i] = 1; continue }
      }
      if (y < size - 1) {
        const d = map.part[i + size]
        if (d !== Part.EMPTY && d !== p && wanted.has((p << 8) | d)) mask[i] = 1
      }
    }
  }
  return mask
}

/// How deep inside the *whole animal* each pixel sits: 0 at the silhouette, 1
/// well inside. A separable box blur of the filled mask.
///
/// This has to be measured against the silhouette, not against each shape's own
/// edge. Per-shape distance puts a dark rim wherever a leg meets the body, and
/// the result looks like a bundle of inflated sausages. That mistake took a long
/// time to diagnose the first time, so it is worth naming here.
export function silhouetteDepth (map, radius) {
  const size = map.size
  const n = size * size
  const mask = new Float32Array(n)
  for (let i = 0; i < n; i++) if (map.part[i] !== Part.EMPTY) mask[i] = 1

  const span = radius * 2 + 1
  const tmp = new Float32Array(n)
  const clamp = v => (v < 0 ? 0 : v > size - 1 ? size - 1 : v)

  for (let y = 0; y < size; y++) {
    const rowBase = y * size
    let sum = 0
    for (let x = -radius; x <= radius; x++) sum += mask[rowBase + clamp(x)]
    for (let x = 0; x < size; x++) {
      tmp[rowBase + x] = sum / span
      sum += mask[rowBase + clamp(x + radius + 1)] - mask[rowBase + clamp(x - radius)]
    }
  }

  const out = new Float32Array(n)
  for (let x = 0; x < size; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) sum += tmp[clamp(y) * size + x]
    for (let y = 0; y < size; y++) {
      out[y * size + x] = sum / span
      sum += tmp[clamp(y + radius + 1) * size + x] - tmp[clamp(y - radius) * size + x]
    }
  }
  return out
}
