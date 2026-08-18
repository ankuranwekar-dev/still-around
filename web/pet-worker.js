// Renders pet animation clips off the main thread.
//
// A page can ask for a clip at whatever resolution its own canvas actually
// needs, at however many frames make the motion look continuous — and both of
// those can be expensive to compute (a full-size grid rasterised forty times
// for one clip). Doing that on the main thread would visibly stall the page
// exactly while the animal is trying to appear. A module worker can import the
// engine directly, so nothing about the rendering code is duplicated here —
// only the framing around it.

import { renderFrame } from '../engine/index.js'
import { named } from '../engine/poses.js'

/// Trim a rendered frame down to its own opaque bounding box before handing it
/// to createImageBitmap. Most of a several-hundred-pixel canvas is transparent
/// margin around a much smaller animal, and storing that margin on every frame
/// of every cached clip is pure waste — cropping first is most of what keeps a
/// working set of clips cheap enough to hold in memory at once. The box travels
/// with the bitmap so the caller can still place it correctly.
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

self.onmessage = async (ev) => {
  const job = ev.data
  if (!job || job.type !== 'job') return

  const clip = named(job.clip)
  const bitmaps = []
  const boxes = []
  let size = 0

  for (let i = 0; i < job.count; i++) {
    // A fractional frame number is fine — `clip.pose(t)` is a continuous
    // function of t, not a lookup — which is exactly what lets this render more
    // samples than the pose library's own nominal frame count and come out
    // smoother rather than just faster.
    const f = renderFrame(job.appearance, {
      animation: job.clip, frame: (i / job.count) * clip.frames, quality: job.quality,
    })
    size = f.size
    const c = crop(f.rgba, f.size)
    bitmaps.push(c ? await createImageBitmap(c.image) : null)
    boxes.push(c ? c.box : null)
    if ((i & 3) === 3) {
      self.postMessage({ type: 'progress', id: job.id, done: i + 1, total: job.count })
    }
  }

  self.postMessage({
    type: 'clip', id: job.id, kind: job.kind, clip: job.clip, quality: job.quality,
    count: job.count, size, duration: clip.frames / clip.fps, loops: clip.loops,
    speed: clip.speed, view: clip.pose(0).view, boxes, bitmaps,
  }, bitmaps.filter(Boolean))
}
