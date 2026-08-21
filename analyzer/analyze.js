// Reads a pet's colouring out of photographs, in the browser.
//
// This is a port of maths that was tuned against real footage of two real cats,
// and two findings from that work are load-bearing here:
//
// 1. **Cluster by colour, not by brightness.** Plain k-means over RGB clusters a
//    coat by how each part was lit, because within one animal light varies more
//    than pigment does. Every test clip came back as three clusters at hue ~30°
//    with luminance 0.32 / 0.44 / 0.58 — so "which cluster is the cat" was really
//    answering "which cluster was in the sun". Brightness is divided out before
//    clustering, and each cluster takes its brightness from the 75th percentile
//    of its own pixels, because most fur in a photo is partly shaded and what an
//    owner recognises is the coat in good light.
//
// 2. **Fur has a gamut.** Cats and dogs are black, grey, white, cream, ginger or
//    brown: near-neutral, or warm between roughly 20° and 38°. A saturated green
//    pixel inside the mask is a floor, a cushion, or a cardboard box. Rejecting
//    those is what stopped one clip rendering a bright green cat.
//
// Eye colour is deliberately *not* guessed here. Three attempts at it in the
// native version each produced confident nonsense — a ginger cat's cheek fur
// measures 0.66 to 0.83 saturation, which beats most of the tests you would
// reach for, and in casual photos the animal is usually squinting. The web
// version asks the person to click their pet's eye instead. One gesture, exact
// answer, and no pretending.

import { starting, Species, CoatPattern, EarStyle, TailStyle, rgb, toHex,
  luminance, saturation, hue,
} from '../engine/appearance.js'
import { zeroMorphs } from '../engine3/species/profiles.js'
import { otsu } from './segment.js'

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

/// Shadows and blown highlights lie about colour, and so does anything outside
/// the fur gamut.
function plausibleFur (c) {
  if (c.l <= 0.10 || c.l >= 0.97) return false
  if (c.s < 0.12) return true // greys and whites: hue is just noise
  // Warm only. The upper bound keeps out greenery and tiles; the lower bound
  // keeps out saturated pure reds, which no animal is but pet beds, cushions and
  // rugs very much are — a red bed in one test photo was being reported as the
  // cat's coat colour.
  if (c.s > 0.45 && c.h < 15) return false
  return (c.h >= 12 && c.h <= 60) || c.h >= 340
}

function colourAt (data, i) {
  const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255
  const c = { r, g, b }
  return { r, g, b, l: luminance(c), s: saturation(c), h: hue(c) }
}

/// Undo the room's lighting before measuring anything. Everything downstream
/// compares against absolute numbers, so a warm lamp or a dim corner would
/// otherwise read as a different coat entirely. The cast correction is bounded so
/// a genuinely ginger animal is never neutralised into grey.
function normalise (pixels) {
  if (pixels.length < 50) return { gain: 1, cast: [1, 1, 1] }
  const lums = pixels.map(p => p.l).sort((a, b) => a - b)
  const p98 = lums[Math.min(lums.length - 1, Math.floor(lums.length * 0.98))]
  const gain = Math.min(2.5, Math.max(0.8, 0.92 / Math.max(0.05, p98)))

  const cutoff = lums[Math.floor(lums.length * 0.90)]
  const bright = pixels.filter(p => p.l >= cutoff)
  if (bright.length < 10) return { gain, cast: [1, 1, 1] }
  const mean = {
    r: bright.reduce((s, p) => s + p.r, 0) / bright.length,
    g: bright.reduce((s, p) => s + p.g, 0) / bright.length,
    b: bright.reduce((s, p) => s + p.b, 0) / bright.length,
  }
  if (saturation(mean) >= 0.38) return { gain, cast: [1, 1, 1] }
  const grey = (mean.r + mean.g + mean.b) / 3
  const factor = ch => Math.min(1.25, Math.max(0.8, grey / Math.max(0.02, ch)))
  return { gain, cast: [factor(mean.r), factor(mean.g), factor(mean.b)] }
}

function applyLight (c, gain, cast) {
  const r = Math.min(1, c.r * gain * cast[0])
  const g = Math.min(1, c.g * gain * cast[1])
  const b = Math.min(1, c.b * gain * cast[2])
  const o = { r, g, b }
  return { r, g, b, l: luminance(o), s: saturation(o), h: hue(o) }
}

// MARK: - Clustering

function kMeansRGB (colours, k, rounds = 8) {
  if (colours.length <= k * 4) {
    return colours.slice(0, k).map(c => ({ colour: c, weight: 1 / k }))
  }
  // Farthest-point seeding: start at the mean, then repeatedly take the colour
  // furthest from everything chosen. Seeding by luminance instead would collapse
  // for chroma clustering, where every input has the same brightness by
  // construction.
  const n = colours.length
  const mean = {
    r: colours.reduce((s, c) => s + c.r, 0) / n,
    g: colours.reduce((s, c) => s + c.g, 0) / n,
    b: colours.reduce((s, c) => s + c.b, 0) / n,
  }
  const dist = (a, b) => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2
  const centres = [mean]
  while (centres.length < k) {
    let far = colours[0], farD = -1
    for (const c of colours) {
      let d = Infinity
      for (const ce of centres) d = Math.min(d, dist(c, ce))
      if (d > farD) { farD = d; far = c }
    }
    centres.push({ r: far.r, g: far.g, b: far.b })
  }

  const assignment = new Int32Array(n)
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity
      for (let j = 0; j < k; j++) {
        const d = dist(colours[i], centres[j])
        if (d < bestD) { bestD = d; best = j }
      }
      assignment[i] = best
    }
    for (let j = 0; j < k; j++) {
      let r = 0, g = 0, b = 0, count = 0
      for (let i = 0; i < n; i++) {
        if (assignment[i] !== j) continue
        r += colours[i].r; g += colours[i].g; b += colours[i].b; count++
      }
      if (count) centres[j] = { r: r / count, g: g / count, b: b / count }
    }
  }
  return centres.map((c, j) => {
    let count = 0
    for (let i = 0; i < n; i++) if (assignment[i] === j) count++
    return { colour: c, weight: count / n }
  })
}

/// Clusters a coat by colour rather than by brightness. See the note at the top
/// of this file — this is the fix that turned muddy grey-brown output into the
/// warm ginger the photographs actually show.
function chromaClusters (colours, k) {
  if (colours.length <= k * 8) return kMeansRGB(colours, k)

  const flat = colours.map(c => {
    const l = Math.max(0.08, c.l)
    return { r: Math.min(1, (c.r / l) * 0.5), g: Math.min(1, (c.g / l) * 0.5), b: Math.min(1, (c.b / l) * 0.5) }
  })
  const centres = kMeansRGB(flat, k).map(c => c.colour)
  const dist = (a, b) => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2

  const groups = Array.from({ length: k }, () => [])
  flat.forEach((f, i) => {
    let best = 0, bestD = Infinity
    for (let j = 0; j < k; j++) {
      const d = dist(f, centres[j])
      if (d < bestD) { bestD = d; best = j }
    }
    groups[best].push(colours[i])
  })

  return groups.filter(g => g.length).map(members => {
    let sr = 0, sg = 0, sb = 0
    for (const m of members) {
      const l = Math.max(0.08, m.l)
      sr += m.r / l; sg += m.g / l; sb += m.b / l
    }
    const n = members.length
    const dir = [sr / n, sg / n, sb / n]
    const lums = members.map(m => m.l).sort((a, b) => a - b)
    // The well-lit end of this cluster, capped so a pet photographed against a
    // window does not come back bleached.
    const lit = Math.min(0.70, lums[Math.floor((lums.length - 1) * 0.75)])
    return {
      colour: { r: Math.min(1, dir[0] * lit), g: Math.min(1, dir[1] * lit), b: Math.min(1, dir[2] * lit) },
      weight: n / colours.length,
    }
  })
}

/// Angular-ish distance between two colours' hues, ignoring brightness.
function hueDistance (a, b) {
  const norm = c => {
    const sum = Math.max(0.01, c.r + c.g + c.b)
    return [c.r / sum, c.g / sum]
  }
  const [ar, ag] = norm(a)
  const [br, bg] = norm(b)
  return Math.hypot(ar - br, ag - bg)
}

// MARK: - Pattern measurement

/// Autocorrelation of row luminance. Tabby striping is periodic across the body
/// at a scale of a few pixels; a plain variance measure calls every shadow a
/// stripe.
function measureStriping (rows) {
  const scores = []
  for (const row of rows) {
    if (row.length < 26) continue
    const mean = row.reduce((s, v) => s + v, 0) / row.length
    const centred = row.map(v => v - mean)
    const denom = centred.reduce((s, v) => s + v * v, 0)
    if (denom < 1e-5) continue
    let best = 0
    for (let lag = 3; lag <= 22 && lag < row.length - 4; lag++) {
      let sum = 0
      for (let i = 0; i + lag < centred.length; i++) sum += centred[i] * centred[i + lag]
      best = Math.max(best, sum / denom)
    }
    scores.push(best)
  }
  if (scores.length < 4) return 0
  scores.sort((a, b) => a - b)
  const median = scores[Math.floor(scores.length / 2)]
  return clamp((median - 0.1) / 0.45)
}

/// A tortoiseshell has two genuinely different *hues* on it, both in quantity.
/// Counting warm and cool pixels separately reported every animal as a calico,
/// because shadowed white fur counts as cool.
function measurePatchiness (coat) {
  if (coat.length < 300) return 0
  const clusters = chromaClusters(coat, 2)
  if (clusters.length < 2) return 0
  const [a, b] = clusters
  const balance = Math.min(a.weight, b.weight) / 0.5
  const gap = hueDistance(a.colour, b.colour)
  const sat = Math.min(saturation(a.colour), saturation(b.colour))
  if (sat <= 0.14) return 0
  return clamp(balance * (gap / 0.16))
}

function choosePattern (patchiness, contrast, white) {
  if (patchiness > 0.42) return CoatPattern.calico
  if (contrast > 0.38) return CoatPattern.tabby
  if (white > 0.5) return CoatPattern.bicolour
  if (white > 0.22) return CoatPattern.tuxedo
  return CoatPattern.solid
}

// MARK: - One photograph

/// Chebyshev distance from each masked pixel to the nearest unmasked one, by two
/// passes over the grid. Used to tell the inside of an animal from its rim.
function edgeDistance (mask, w, h) {
  const BIG = 1 << 15
  const d = new Int32Array(w * h)
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? BIG : 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!d[i]) continue
      let best = d[i]
      if (y > 0) best = Math.min(best, d[i - w] + 1)
      if (x > 0) best = Math.min(best, d[i - 1] + 1)
      if (y > 0 && x > 0) best = Math.min(best, d[i - w - 1] + 1)
      if (y > 0 && x < w - 1) best = Math.min(best, d[i - w + 1] + 1)
      d[i] = best
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!d[i]) continue
      let best = d[i]
      if (y < h - 1) best = Math.min(best, d[i + w] + 1)
      if (x < w - 1) best = Math.min(best, d[i + 1] + 1)
      if (y < h - 1 && x < w - 1) best = Math.min(best, d[i + w + 1] + 1)
      if (y < h - 1 && x > 0) best = Math.min(best, d[i + w - 1] + 1)
      d[i] = best
    }
  }
  return d
}

function samplePhoto (image, mask) {
  const { width: w, height: h, data } = image
  const raw = []
  let minX = w, maxX = 0, minY = h, maxY = 0

  // Whatever the segmenter gets wrong, it gets wrong at the *rim*: a skirt of
  // sofa or wall a few pixels wide all the way round the animal. That skirt is
  // ruinous out of proportion to its size on a mostly-white animal, because the
  // animal's own pixels are largely desaturated and drop out of the colour vote —
  // so a grey wall wins the coat outright and the ginger is demoted to "second
  // colour". Measured: at 55% background in the mask a ginger-and-white cat came
  // back grey-coated, which is exactly the bug this is here to stop.
  //
  // So the rim does not get a vote. Thin parts — legs, tails, ears — are all rim,
  // which is why this backs off rather than insisting: if trimming would cost
  // most of the animal, it trims less, and eventually not at all.
  const area = mask.reduce((n, v) => n + (v ? 1 : 0), 0)
  if (area < 200) return null
  const dist = edgeDistance(mask, w, h)
  let rim = Math.max(1, Math.round(Math.sqrt(area) * 0.055))
  while (rim > 0) {
    let kept = 0
    for (let i = 0; i < dist.length; i++) if (dist[i] > rim) kept++
    if (kept >= area * 0.35) break
    rim = rim > 1 ? Math.floor(rim / 2) : 0
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      // The bounding box still comes from the whole mask: it frames where the
      // animal is, and the regions below are fractions of that frame.
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (dist[i] <= rim) continue
      raw.push({ c: colourAt(data, i), x, y })
    }
  }
  if (raw.length < 200) return null

  const { gain, cast } = normalise(raw.map(p => p.c))
  const points = raw.map(p => ({ c: applyLight(p.c, gain, cast), x: p.x, y: p.y }))

  // The white cut-off is set per photograph. A fixed threshold classified a
  // mostly-white cat as 24% white and dragged its base colour to beige, because
  // indoor light makes white fur warm and dim.
  //
  // Otsu alone is not enough on a close-up. It looks for a bright half and a dark
  // half, and a face filling the frame in good light has no dark half — so it
  // split inside the fur and reported a tabby face as 99% white. Holding the
  // threshold above the animal's own median luminance fixes that: white has to be
  // brighter than this animal generally is, not merely bright.
  const lums = points.map(p => p.c.l).sort((x, y) => x - y)
  const median = lums[Math.floor(lums.length / 2)]
  const cut = Math.max(0.55, Math.min(0.84, Math.max(otsu(lums), median + 0.10)))
  const isWhite = c => c.l > cut && c.s < 0.30

  const whiteFraction = points.filter(p => isWhite(p.c)).length / points.length

  let coat = points.filter(p => !isWhite(p.c) && plausibleFur(p.c)).map(p => p.c)
  if (whiteFraction > 0.40) {
    // Mostly-white animal: the colour that matters is in the patches, not in the
    // grey fringe where white meets colour.
    const saturated = coat.filter(c => c.s > 0.16)
    if (saturated.length > 200) coat = saturated
  }

  // Regions, from geometry alone. There is no animal pose estimator in a
  // browser, so instead of pretending to know where the head is, only the
  // measurements that survive that ignorance are taken: white low down is socks,
  // white in the lower middle is a chest or belly.
  const boxW = Math.max(1, maxX - minX)
  const boxH = Math.max(1, maxY - minY)
  const region = (yLow, yHigh, xLow = 0, xHigh = 1) => {
    const px = points.filter(p => {
      const ry = (p.y - minY) / boxH
      const rx = (p.x - minX) / boxW
      return ry >= yLow && ry <= yHigh && rx >= xLow && rx <= xHigh
    })
    if (!px.length) return { white: 0, count: 0 }
    return { white: px.filter(p => isWhite(p.c)).length / px.length, count: px.length }
  }

  // Row luminance runs, for the striping test.
  const rows = []
  const byRow = new Map()
  for (const p of points) {
    if (isWhite(p.c) || !plausibleFur(p.c)) continue
    if (!byRow.has(p.y)) byRow.set(p.y, [])
    byRow.get(p.y).push({ x: p.x, l: p.c.l })
  }
  for (const [, row] of byRow) {
    row.sort((a, b) => a.x - b.x)
    rows.push(row.map(r => r.l))
  }

  return {
    coat,
    whiteFraction,
    chest: region(0.45, 0.85, 0.25, 0.75).white,
    legs: region(0.82, 1.0).white,
    upper: region(0.0, 0.35).white,
    // A blaze is not "white" — it is white up the *middle* with colour either
    // side. Measuring the centre band against the flanks is the difference
    // between reading Momo's stripe and calling every white-faced cat blazed.
    centreWhite: region(0.15, 1.0, 0.38, 0.62).white,
    flankWhite: Math.max(
      region(0.15, 1.0, 0.0, 0.26).white,
      region(0.15, 1.0, 0.74, 1.0).white
    ),
    stripiness: measureStriping(rows),
    patchiness: measurePatchiness(coat),
    pixels: points.length,
    aspect: boxW / boxH,
  }
}

// MARK: - Assembly

/// `photos` is an array of { image: ImageData, mask: Uint8Array }.
/// `eye` is an optional {r,g,b} in 0..1 that the person picked by clicking.
export function readAppearance (photos, { species = Species.cat, eye = null } = {}) {
  const notes = []
  const samples = []
  photos.forEach((p, i) => {
    const s = samplePhoto(p.image, p.mask)
    if (s) { samples.push(s); notes.push(`photo ${i + 1}: ${s.pixels} px, ${Math.round(s.whiteFraction * 100)}% white`) }
    else notes.push(`photo ${i + 1}: not enough of the animal to measure`)
  })

  const a = starting(species)
  if (!samples.length) {
    notes.push('could not measure anything — showing a starting point to adjust')
    return { appearance: a, notes, confident: false }
  }

  // Not every photo deserves an equal vote. A frame where the animal is forty
  // pixels across measures the carpet as much as the pet.
  const best = Math.max(...samples.map(s => s.pixels))
  let used = samples
  if (best > 4000) {
    const kept = samples.filter(s => s.pixels >= best * 0.25)
    if (kept.length && kept.length < samples.length) {
      notes.push(`ignored ${samples.length - kept.length} distant photo(s)`)
      used = kept
    }
  }

  const coat = used.flatMap(s => s.coat)
  // The deepest shadows go because their hue is unreliable, not because they are
  // dark — clustering handles brightness on its own now.
  let pool = coat
  if (coat.length > 600) {
    pool = [...coat].sort((x, y) => x.l - y.l).slice(Math.floor(coat.length / 5))
  }

  // Weight alone picks the wrong colour on a white-and-ginger animal: the biggest
  // cluster is the washed-out fringe where white meets colour, and the ginger
  // that makes the animal recognisable is second. Pushing saturation
  // superlinearly lets a smaller, genuinely coloured cluster win, while a solid
  // grey pet still comes back grey because it has no saturated cluster to lose to.
  const identity = c => c.weight * (0.15 + saturation(c.colour)) ** 1.5
  const clusters = chromaClusters(pool, 3).sort((x, y) => identity(y) - identity(x))

  if (clusters[0]) a.base = rgb(clusters[0].colour.r, clusters[0].colour.g, clusters[0].colour.b)
  if (clusters[1]) a.accent = rgb(clusters[1].colour.r, clusters[1].colour.g, clusters[1].colour.b)

  const mean = key => used.reduce((s, x) => s + x[key], 0) / used.length
  const white = mean('whiteFraction')

  a.patternContrast = clamp(mean('stripiness'))
  a.patchiness = clamp(mean('patchiness'))
  a.pattern = choosePattern(a.patchiness, a.patternContrast, white)
  a.chestWhite = clamp(mean('chest'))
  a.socks = clamp((mean('legs') - 0.25) / 0.6)
  // Cap coverage is the inverse of how much white is up top. Without a head
  // locator this is the honest version: it is right for a sitting animal and
  // approximately right otherwise, and it is one of the sliders anyway.
  a.capCoverage = clamp(1 - mean('upper') * 0.9, 0.15, 1)
  a.faceBlaze = clamp((white - 0.30) * 1.1)
  a.saddle = clamp(1 - Math.max(0, white - 0.45) * 0.9, 0.2, 1)
  a.tailBands = a.pattern === CoatPattern.tabby ? clamp(a.patternContrast * 0.8) : 0
  a.faceMask = clamp(a.patternContrast * 0.6)

  if (eye) {
    a.eye = rgb(eye.r, eye.g, eye.b)
    notes.push(`eye colour ${toHex(a.eye)}, from the spot you picked`)
  } else {
    notes.push('eye colour left at a default — click your pet\'s eye to set it exactly')
  }

  // Build and shape, from the silhouette's proportions. Coarse, but it separates
  // a long low animal from a compact one.
  const aspect = mean('aspect')
  a.build = clamp((aspect - 1.15) * 0.9, -0.6, 0.9)
  if (species === Species.dog) {
    a.earStyle = EarStyle.floppy
    a.snout = 0.75
    a.tailStyle = TailStyle.long
    a.size = clamp(1.0 + (aspect - 1.2) * 0.35, 0.8, 1.35)
  }

  notes.push(`base ${toHex(a.base)}, second colour ${toHex(a.accent)}`)
  notes.push(`${Math.round(white * 100)}% white, pattern read as ${a.pattern}`)
  return { appearance: a, notes, confident: used.some(s => s.pixels > 3000) }
}

// MARK: - Reading a shot list

/// Measure a pet from named shots rather than an undifferentiated pile.
///
/// `shots` is `{ face: {image, mask}, side: {...}, front: {...}, tail: {...} }`,
/// any of which may be missing. Each parameter is read from the shot that can see
/// it — see `shots.js` for which is which — and anything nobody could see keeps
/// its default, which is honest and leaves the slider where the owner can find it.
///
/// This exists because averaging everything over every photograph loses
/// information rather than gaining it. A face close-up has no opinion about a
/// white chest, and a side view cannot see a blaze; letting each vote on the other
/// is how a ginger-and-white cat with a bib came out as a uniform grey tabby.
export function readFromShots (shots, { species = Species.cat, eye = null } = {}) {
  const notes = []
  const a = starting(species)
  a.morphs = zeroMorphs()
  const measured = new Set()

  const read = id => {
    const shot = shots[id]
    if (!shot) return null
    const sample = samplePhoto(shot.image, shot.mask)
    if (!sample) { notes.push(`the "${id}" photo had too little of the animal in it`); return null }
    return sample
  }

  const face = read('face')
  const side = read('side')
  const front = read('front')
  const tail = read('tail')

  // Colour comes from the side view first — it sees the most fur in the most
  // even light — and falls back to whatever else exists.
  const colourSource = side || front || tail || face
  if (colourSource) {
    const pool = shadowTrimmed(colourSource.coat)
    const clusters = chromaClusters(pool, 3).sort((x, y) => identityScore(y) - identityScore(x))
    if (clusters[0]) { a.base = rgb(clusters[0].colour.r, clusters[0].colour.g, clusters[0].colour.b); measured.add('base') }
    if (clusters[1]) { a.accent = rgb(clusters[1].colour.r, clusters[1].colour.g, clusters[1].colour.b); measured.add('accent') }
    notes.push(`coat colours from the ${side ? 'side' : front ? 'front' : tail ? 'tail' : 'face'} photo`)
  }

  if (side) {
    a.patternContrast = clamp(side.stripiness)
    a.patchiness = clamp(side.patchiness)
    a.saddle = clamp(1 - Math.max(0, side.whiteFraction - 0.45) * 0.9, 0.2, 1)
    a.build = clamp((side.aspect - 1.15) * 0.9, -0.6, 0.9)
    if (species === Species.dog) a.size = clamp(1.0 + (side.aspect - 1.2) * 0.35, 0.8, 1.35)
    a.tailBands = a.patternContrast > 0.38 ? clamp(a.patternContrast * 0.8) : 0
    a.morphs.backLength = clamp((side.aspect - 1.2) * 0.9, -1, 1)
    a.morphs.bodyMass = clamp(a.build, -1, 1)
    a.morphs.chestDepth = clamp(a.build * 0.5 + (species === Species.dog ? 0.25 : 0), -1, 1)
    a.morphs.legLength = species === Species.dog
      ? clamp((a.size - 1.05) * 2.2, -1, 1)
      : clamp((a.size - 1) * 1.2, -1, 1)
    a.morphs.waistTuck = species === Species.dog ? clamp(0.3 - a.build * 0.2, 0, 1) : 0.05
    a.morphs.toplineSlope = species === Species.dog ? 0.35 : 0.05
    a.morphs.muzzleLength = clamp((a.snout - 0.4) * 1.8, -1, 1)
    for (const k of ['patternContrast', 'patchiness', 'saddle', 'build']) measured.add(k)
    notes.push(`stripes ${Math.round(a.patternContrast * 100)}%, patches ${Math.round(a.patchiness * 100)}% from the side photo`)
  }

  if (face) {
    // On a face shot the frame *is* the head, so white low in the frame is a
    // white chin and muzzle, and white up the middle is a blaze.
    a.capCoverage = clamp(1 - face.upper * 0.9, 0.15, 1)
    // The stripe only exists if the centre is whiter than the sides. An earlier
    // version took the whole white fraction, which gave a solid white cat a
    // blaze of 1.0 — white everywhere is not a marking.
    a.faceBlaze = clamp((face.centreWhite - face.flankWhite) * 1.7)
    a.faceMask = clamp((side ? side.stripiness : face.stripiness) * 0.6)
    for (const k of ['capCoverage', 'faceBlaze', 'faceMask']) measured.add(k)
    notes.push(`face markings from the face photo — ${Math.round(face.whiteFraction * 100)}% white`)
    a.morphs.skullWidth = clamp((1.05 - face.aspect) * 0.8, -1, 1)
  }

  if (front) {
    a.chestWhite = clamp(front.chest)
    a.socks = clamp((front.legs - 0.25) / 0.6)
    measured.add('chestWhite'); measured.add('socks')
    notes.push(`white chest ${Math.round(a.chestWhite * 100)}%, socks ${Math.round(a.socks * 100)}% from the sitting photo`)
  } else if (side) {
    // Second best: the belly line in a side view still shows a white front.
    a.chestWhite = clamp(side.chest * 0.8)
    a.socks = clamp((side.legs - 0.3) / 0.7)
  }

  if (tail) {
    a.tailBands = clamp(tail.stripiness * 0.9)
    measured.add('tailBands')
    notes.push(`tail rings ${Math.round(a.tailBands * 100)}% from the tail photo`)
    a.morphs.tailLength = clamp(tail.aspect * 0.25 - 0.1, -1, 1)
    a.morphs.tailFluff = clamp(a.furLength, 0, 1)
  }

  if (eye) {
    a.eye = rgb(eye.r, eye.g, eye.b)
    measured.add('eye')
    notes.push(`eye colour ${toHex(a.eye)}, from the spot you picked`)
  }

  if (species === Species.dog) {
    a.earStyle = EarStyle.floppy
    a.snout = 0.75
    a.tailStyle = TailStyle.long
  }

  a.pattern = choosePattern(a.patchiness, a.patternContrast,
    (side || face || front)?.whiteFraction ?? 0)

  return { appearance: a, notes, measured: [...measured], missing: missingFor(shots) }
}

function missingFor (shots) {
  return ['face', 'side', 'front', 'tail'].filter(id => !shots[id])
}

/// The deepest shadows go because their hue is unreliable, not because they are
/// dark — the clustering handles brightness by itself.
function shadowTrimmed (coat) {
  if (coat.length <= 600) return coat
  return [...coat].sort((x, y) => x.l - y.l).slice(Math.floor(coat.length / 5))
}

/// Weight alone picks the washed-out fringe where white meets colour; pushing
/// saturation superlinearly lets the colour that makes the animal recognisable win.
function identityScore (c) {
  return c.weight * (0.15 + saturation(c.colour)) ** 1.5
}
