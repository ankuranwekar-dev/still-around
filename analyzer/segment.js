// Cutting the animal out of the room, in a browser, with no model to download.
//
// The native version of this used Apple's Vision framework, which will happily
// hand back a foreground instance mask. There is no equivalent built into a
// browser, and shipping a segmentation model would mean a multi-megabyte
// download and — worse — would undercut the promise that nothing about someone's
// pet leaves their tab.
//
// So this is classical: build a colour model of the background from the edges of
// the frame, score every pixel against it, threshold, then keep the biggest
// blob. It is not as good as a neural net. It does not need to be, because the
// person looking at the result can drag a box around their pet and this runs
// again inside it, which is both more accurate than any automatic method and
// takes one gesture.

/// Downscale an ImageData for analysis. 220px wide is plenty — a coat's colours
/// do not live in the high frequencies, and the segmentation below is O(pixels).
///
/// A plain box filter rather than a canvas draw, deliberately: it takes ImageData
/// and returns ImageData, so the identical code path runs in a browser, in a
/// worker, and under Node in the offline test harness. Routing this through
/// OffscreenCanvas.drawImage was the first version, and it threw on ImageData
/// input — drawImage wants an image, not raw pixels.
export function toSmall (source, width = 220) {
  const w = Math.min(width, source.width)
  if (w === source.width) return source
  const h = Math.max(1, Math.round(w * (source.height / source.width)))
  const out = new Uint8ClampedArray(w * h * 4)
  const sx = source.width / w
  const sy = source.height / h

  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.min(source.height, Math.floor((y + 1) * sy)))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.min(source.width, Math.floor((x + 1) * sx)))
      let r = 0, g = 0, b = 0, n = 0
      for (let oy = y0; oy < y1; oy++) {
        for (let ox = x0; ox < x1; ox++) {
          const i = (oy * source.width + ox) * 4
          r += source.data[i]; g += source.data[i + 1]; b += source.data[i + 2]; n++
        }
      }
      const d = (y * w + x) * 4
      out[d] = r / n; out[d + 1] = g / n; out[d + 2] = b / n; out[d + 3] = 255
    }
  }
  return { width: w, height: h, data: out }
}

function luminanceOf (r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/// Otsu's method over 0..1 values: the split that best separates two groups.
export function otsu (values) {
  if (values.length < 20) return 0.6
  const bins = 64
  const hist = new Int32Array(bins)
  for (const v of values) hist[Math.min(bins - 1, Math.max(0, Math.floor(v * (bins - 1))))]++
  const total = values.length
  let sum = 0
  for (let i = 0; i < bins; i++) sum += i * hist[i]
  let sumB = 0, weightB = 0, best = 0, threshold = bins >> 1
  for (let i = 0; i < bins; i++) {
    weightB += hist[i]
    if (weightB === 0) continue
    const weightF = total - weightB
    if (weightF === 0) break
    sumB += i * hist[i]
    const meanB = sumB / weightB
    const meanF = (sum - sumB) / weightF
    const between = weightB * weightF * (meanB - meanF) ** 2
    if (between > best) { best = between; threshold = i }
  }
  return threshold / (bins - 1)
}

/// Rough colour clusters, used here only to describe the background.
function clusterColours (samples, k, rounds = 6) {
  if (samples.length < k * 4) return samples.slice(0, k)
  const sorted = [...samples].sort((a, b) =>
    luminanceOf(a[0], a[1], a[2]) - luminanceOf(b[0], b[1], b[2]))
  let centres = []
  for (let i = 0; i < k; i++) {
    centres.push(sorted[Math.floor(((i + 1) / (k + 1)) * sorted.length)])
  }
  for (let r = 0; r < rounds; r++) {
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0])
    for (const s of samples) {
      let best = 0, bestD = Infinity
      for (let j = 0; j < k; j++) {
        const c = centres[j]
        const d = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2
        if (d < bestD) { bestD = d; best = j }
      }
      const acc = sums[best]
      acc[0] += s[0]; acc[1] += s[1]; acc[2] += s[2]; acc[3]++
    }
    centres = centres.map((c, j) => {
      const acc = sums[j]
      return acc[3] ? [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]] : c
    })
  }
  return centres
}

/// Keep only the largest connected run of mask pixels, then close small holes.
/// Without this the mask picks up a cushion in one corner and a lamp in another,
/// and the "animal" ends up being the room's warm patches.
export function largestBlob (mask, w, h) {
  const labels = new Int32Array(w * h)
  const stack = new Int32Array(w * h)
  let bestLabel = 0, bestCount = 0, label = 0

  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue
    label++
    let count = 0
    let sp = 0
    stack[sp++] = i
    labels[i] = label
    while (sp > 0) {
      const p = stack[--sp]
      count++
      const x = p % w, y = (p / w) | 0
      if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = label; stack[sp++] = p - 1 }
      if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = label; stack[sp++] = p + 1 }
      if (y > 0 && mask[p - w] && !labels[p - w]) { labels[p - w] = label; stack[sp++] = p - w }
      if (y < h - 1 && mask[p + w] && !labels[p + w]) { labels[p + w] = label; stack[sp++] = p + w }
    }
    if (count > bestCount) { bestCount = count; bestLabel = label }
  }

  const out = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) if (labels[i] === bestLabel) out[i] = 1
  return { mask: out, count: bestCount }
}

/// Fill interior gaps: any hole not reachable from the frame edge is inside the
/// animal. Dark fur often fails the colour test, and unfilled holes let the
/// background's colour leak into the coat measurement.
export function fillHoles (mask, w, h) {
  const outside = new Uint8Array(w * h)
  const stack = []
  const push = i => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i) } }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (stack.length) {
    const p = stack.pop()
    const x = p % w, y = (p / w) | 0
    if (x > 0) push(p - 1)
    if (x < w - 1) push(p + 1)
    if (y > 0) push(p - w)
    if (y < h - 1) push(p + w)
  }
  const out = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = mask[i] || !outside[i] ? 1 : 0
  return out
}

/// Segment the animal.
///
/// `box` is an optional { x, y, w, h } in 0..1 image coordinates. When present
/// everything outside it is background for certain, which turns a hard problem
/// into an easy one — that is the whole reason the UI offers the gesture.
export function segment (image, box = null) {
  const { width: w, height: h, data } = image
  const n = w * h

  const inBox = i => {
    if (!box) return true
    const x = (i % w) / w
    const y = ((i / w) | 0) / h
    return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h
  }

  // Background model: sampled from a frame around the edge of the image, or just
  // outside the box when there is one.
  const border = []
  const margin = Math.max(2, Math.round(Math.min(w, h) * 0.06))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const edge = box
        ? !inBox(i)
        : x < margin || y < margin || x >= w - margin || y >= h - margin
      if (!edge) continue
      border.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]])
      if (border.length > 6000) break
    }
  }
  const bg = clusterColours(border, 4)

  // Score: how unlike the background each pixel is, with a mild centre bias.
  const score = new Float32Array(n)
  const cx = box ? (box.x + box.w / 2) * w : w / 2
  const cy = box ? (box.y + box.h / 2) * h : h / 2
  const spanX = box ? Math.max(1, (box.w * w) / 2) : w / 2
  const spanY = box ? Math.max(1, (box.h * h) / 2) : h / 2

  for (let i = 0; i < n; i++) {
    if (!inBox(i)) { score[i] = 0; continue }
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
    let nearest = Infinity
    for (const c of bg) {
      const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2
      if (d < nearest) nearest = d
    }
    // Normalised so the threshold below is scale-free.
    const unlike = Math.min(1, Math.sqrt(nearest) / 140)
    const x = i % w, y = (i / w) | 0
    const radial = Math.min(1, Math.hypot((x - cx) / spanX, (y - cy) / spanY))
    const centreBias = 1 - radial * 0.45
    score[i] = unlike * centreBias
  }

  const cut = Math.max(0.22, Math.min(0.68, otsu(Array.from(score))))
  const rough = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (score[i] >= cut) rough[i] = 1

  const blob = largestBlob(rough, w, h)
  // If the blob is implausibly small the scene defeated us; fall back to the box
  // (or the middle of the frame) so the caller still gets usable colours rather
  // than nothing at all.
  if (blob.count < n * 0.02) {
    const fallback = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const x = (i % w) / w, y = ((i / w) | 0) / h
      const b = box || { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) fallback[i] = 1
    }
    return { mask: fallback, width: w, height: h, confident: false }
  }

  return { mask: fillHoles(blob.mask, w, h), width: w, height: h, confident: true }
}

/// Shrink a full-resolution mask to match a `toSmall`-sized image. The model
/// works at the photograph's own size; the colour maths runs on a 220px version,
/// and both need to agree about which pixels are the animal.
export function shrinkMask (mask, from, to) {
  const out = new Uint8Array(to.width * to.height)
  const sx = from.width / to.width
  const sy = from.height / to.height
  for (let y = 0; y < to.height; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.min(from.height, Math.floor((y + 1) * sy)))
    for (let x = 0; x < to.width; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.min(from.width, Math.floor((x + 1) * sx)))
      // Majority vote, so a thin tail survives downscaling but a stray pixel does
      // not become a whole block of "animal".
      let on = 0, total = 0
      for (let oy = y0; oy < y1; oy++) {
        for (let ox = x0; ox < x1; ox++) { on += mask[oy * from.width + ox]; total++ }
      }
      out[y * to.width + x] = on * 2 >= total ? 1 : 0
    }
  }
  return out
}

/// Paint the cutout onto a canvas so someone can see what was found. Being able
/// to see the mask is what makes the "drag a box" affordance make sense.
export function maskPreview (image, mask) {
  const { width: w, height: h, data } = image
  const out = new ImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    if (mask[i]) {
      out.data[o] = data[o]
      out.data[o + 1] = data[o + 1]
      out.data[o + 2] = data[o + 2]
      out.data[o + 3] = 255
    } else {
      // Dimmed rather than deleted, so the person can still see the context.
      out.data[o] = data[o] * 0.22 + 20
      out.data[o + 1] = data[o + 1] * 0.22 + 24
      out.data[o + 2] = data[o + 2] * 0.22 + 30
      out.data[o + 3] = 255
    }
  }
  return out
}
