// Finding the animal properly, with a real segmentation model.
//
// The first version of this project cut the pet out with a classical method: a
// colour model of the background sampled from the edges of the frame, a centre
// prior, a threshold. It works on a clean photo and fails badly on a real one —
// on our own test footage it grabbed a fridge door, a tiled floor and a red pet
// bed, and a cat measured from a tiled floor comes out grey. That is fatal for
// this app, because the entire promise is that the pet on screen is *their* pet.
//
// So this runs actual models, in the browser, on the visitor's own machine:
//
//   1. A tiny COCO detector finds the cat or dog and returns a box. This also
//      tells us the species, so nobody has to pick from a menu, and it rejects
//      photographs where there is no animal at all.
//   2. SlimSAM turns that box into a precise mask. SlimSAM is Segment Anything
//      compressed from 637M parameters to 5.5M — 13.8 MB for encoder and decoder
//      together, quantized — which is small enough to download once on a phone.
//
// Prompted segmentation beats automatic background removal here for two reasons
// beyond size: it is told *which* object to cut out rather than guessing at the
// most salient one, and when it still gets it wrong the person can click their
// pet and it tries again from that point. The alternative, a general
// background-removal network like BiRefNet, is genuinely better on fur edges but
// the smallest usable build is 115 MB and it has no idea whether it is looking at
// an animal or a houseplant.
//
// Everything still runs locally. Model weights come from a CDN once and are
// cached by the browser; the photographs never leave the tab.

const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5'

/// COCO classes we care about. Anything else in the frame is furniture.
const PET_LABELS = { cat: 'cat', dog: 'dog' }

let libraryPromise = null
let detectorPromise = null
let samPromise = null

/// State the loader reports so the UI can be honest about a 20 MB download
/// rather than looking frozen.
export const vision = {
  available: null,   // null = not tried yet, true/false once known
  status: 'idle',
  error: null,
}

/// Load transformers.js from wherever it is available.
///
/// The installed package first, so Node and a bundled desktop build work offline
/// and so the offline test harness can exercise this exact code; then the CDN,
/// which is the path a plain browser takes. A bare specifier throws at runtime in
/// a browser rather than at parse time, which is what makes the fallback possible.
async function library () {
  if (!libraryPromise) {
    libraryPromise = (async () => {
      let mod
      try {
        mod = await import(/* @vite-ignore */ '@huggingface/transformers')
      } catch {
        mod = await import(/* @vite-ignore */ `${CDN}/dist/transformers.min.js`)
      }
      // Remote models. There is no bundled copy to look for, and without this the
      // library spends a request on every load looking for one.
      mod.env.allowLocalModels = false
      // The browser cache is what makes the download a one-time cost — but asking
      // for it under Node throws outright, so it is set only where it exists.
      if (typeof window !== 'undefined') mod.env.useBrowserCache = true
      return mod
    })()
  }
  return libraryPromise
}

/// Quantized weights unless the machine has WebGPU, where fp16 is both faster and
/// better. On WASM the q8 build is roughly a third of the download and the
/// quality difference on a mask this size is not visible.
async function bestDtype () {
  const inBrowser = typeof window !== 'undefined'
  try {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) return { dtype: 'fp16', device: 'webgpu' }
    }
  } catch { /* fall through to the CPU backend */ }
  // The backend names differ by runtime: a browser without WebGPU runs the
  // WebAssembly build, while Node only accepts cpu / coreml / webgpu and rejects
  // "wasm" outright. Getting this wrong fails at load with an unhelpful message.
  return { dtype: 'q8', device: inBrowser ? 'wasm' : 'cpu' }
}

async function loadDetector (onProgress) {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { pipeline } = await library()
      const { dtype, device } = await bestDtype()
      // YOLOS-tiny: 6.5M parameters, COCO's eighty classes, which include cat and
      // dog. Big enough to find an animal in a room, small enough not to matter.
      return pipeline('object-detection', 'Xenova/yolos-tiny', {
        dtype, device,
        progress_callback: onProgress,
      })
    })()
  }
  return detectorPromise
}

async function loadSam (onProgress) {
  if (!samPromise) {
    samPromise = (async () => {
      const { SamModel, AutoProcessor } = await library()
      const { dtype, device } = await bestDtype()
      const [model, processor] = await Promise.all([
        SamModel.from_pretrained('Xenova/slimsam-77-uniform', {
          dtype, device, progress_callback: onProgress,
        }),
        AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform'),
      ])
      return { model, processor }
    })()
  }
  return samPromise
}

/// Warm both models up. Called when someone opens the studio, so the download
/// overlaps with them choosing files instead of happening after.
export async function prepare (onProgress = null) {
  if (vision.available === false) return false
  try {
    vision.status = 'loading'
    const report = p => {
      if (p?.status === 'progress' && p.total) {
        vision.status = `downloading ${p.file?.split('/').pop() || 'model'} — ${Math.round((p.loaded / p.total) * 100)}%`
      }
      if (onProgress) onProgress(vision.status)
    }
    await Promise.all([loadDetector(report), loadSam(report)])
    vision.available = true
    vision.status = 'ready'
    return true
  } catch (err) {
    // Offline, an old browser, a blocked CDN — all end up here, and all of them
    // are survivable because the classical segmenter is still there.
    vision.available = false
    vision.error = err?.message || String(err)
    vision.status = 'unavailable'
    console.warn('[vision] falling back to the classical cutout:', vision.error)
    return false
  }
}

function toRawImage (RawImage, image) {
  // ImageData is RGBA; RawImage wants to know the channel count.
  return new RawImage(new Uint8ClampedArray(image.data), image.width, image.height, 4).rgb()
}

/// Find the pet. Returns { species, box: {x, y, w, h} in 0..1, score } or null.
///
/// The largest confident animal wins rather than the highest-scoring one: in a
/// photo with a cat on a sofa and a dog asleep in the background, the one filling
/// the frame is the one being photographed.
export async function detectPet (image, { minScore = 0.35 } = {}) {
  const detector = await loadDetector()
  const { RawImage } = await library()
  const results = await detector(toRawImage(RawImage, image), { threshold: minScore })

  let best = null
  for (const r of results) {
    const species = PET_LABELS[r.label]
    if (!species) continue
    const { xmin, ymin, xmax, ymax } = r.box
    const area = (xmax - xmin) * (ymax - ymin)
    if (!best || area > best.area) {
      best = {
        species,
        score: r.score,
        area,
        box: {
          x: xmin / image.width,
          y: ymin / image.height,
          w: (xmax - xmin) / image.width,
          h: (ymax - ymin) / image.height,
        },
      }
    }
  }
  return best
}

/// Cut the animal out. Prompt with a box (from the detector), a point (from the
/// person clicking their pet), or both — SAM takes either, and a point inside a
/// box is the most reliable combination there is.
///
/// Returns { mask: Uint8Array, width, height } at the given image's size.
export async function segmentWithSam (image, { box = null, point = null } = {}) {
  const { model, processor } = await loadSam()
  const { RawImage } = await library()
  const raw = toRawImage(RawImage, image)

  // Points, not boxes. This export of SlimSAM accepts `input_boxes` without
  // complaint and then ignores it: measured against the detector's box, every
  // candidate mask spilled between 0.3x and 8x the box area, because the model
  // was working purely from the point prompt. The box is still enormously useful
  // — but as a place to put points and as a yardstick for judging the results,
  // not as a prompt.
  //
  // Five points spread through the box rather than one in the middle. A single
  // centre point is unreliable because the centre of a bounding box is very often
  // not the animal: on a cat sitting on a fridge, the box's centre is fridge, and
  // SAM dutifully segmented the fridge.
  const points = []
  if (point) {
    points.push([Math.round(point.x * image.width), Math.round(point.y * image.height)])
  }
  if (box) {
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    for (const [fx, fy] of [[0, 0], [0, -0.26], [0, 0.26], [-0.22, 0.05], [0.22, 0.05]]) {
      points.push([
        Math.round((cx + fx * box.w) * image.width),
        Math.round((cy + fy * box.h) * image.height),
      ])
    }
  }
  if (!points.length) {
    points.push([Math.round(image.width / 2), Math.round(image.height / 2)])
  }

  const inputs = {
    input_points: [[points]],
    input_labels: [[points.map(() => 1n)]], // 1 = "this is the thing I want"
  }

  const processed = await processor(raw, inputs)
  const outputs = await model(processed)
  const masks = await processor.post_process_masks(
    outputs.pred_masks, processed.original_sizes, processed.reshaped_input_sizes
  )

  // SAM proposes three masks at different scopes — roughly a subpart, a part, and
  // the whole object. Its own confidence ranks them, and on this task that
  // ranking is actively misleading: for the cat on the fridge the most confident
  // mask was the fridge, at 0.97.
  //
  // The detector's box is the better judge. The animal fills its own box and stops
  // there, so the mask that covers the most of the box while spilling least out of
  // it is the animal. Measured over the test photographs this picks correctly
  // every time, including the ones where confidence does not.
  const scores = outputs.iou_scores.data
  const tensor = masks[0]
  const [, count, height, width] = tensor.dims
  const plane = tensor.data
  const stride = height * width

  const bounds = box
    ? {
        x0: Math.floor(box.x * width), x1: Math.ceil((box.x + box.w) * width),
        y0: Math.floor(box.y * height), y1: Math.ceil((box.y + box.h) * height),
      }
    : null

  let bestIndex = 0
  let bestFit = -Infinity
  let bestFill = 0
  let bestSpill = 0
  for (let m = 0; m < count; m++) {
    if (!bounds) {
      if (scores[m] > bestFit) { bestFit = scores[m]; bestIndex = m }
      continue
    }
    let inside = 0
    let outside = 0
    const at = m * stride
    for (let y = 0; y < height; y++) {
      const inRow = y >= bounds.y0 && y < bounds.y1
      for (let x = 0; x < width; x++) {
        if (!plane[at + y * width + x]) continue
        if (inRow && x >= bounds.x0 && x < bounds.x1) inside++
        else outside++
      }
    }
    const boxArea = Math.max(1, (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0))
    const fill = inside / boxArea
    const spill = outside / boxArea
    const fit = fill - spill * 1.5
    if (fit > bestFit) { bestFit = fit; bestIndex = m; bestFill = fill; bestSpill = spill }
  }

  const offset = bestIndex * stride
  const mask = new Uint8Array(stride)
  for (let i = 0; i < stride; i++) mask[i] = plane[offset + i] ? 1 : 0

  // Nothing outside the detector's box is the animal. Cheap, and it is what stops
  // a warm floor beside a ginger cat being measured as part of the cat.
  if (bounds) {
    for (let y = 0; y < height; y++) {
      const inRow = y >= bounds.y0 && y < bounds.y1
      for (let x = 0; x < width; x++) {
        if (!inRow || x < bounds.x0 || x >= bounds.x1) mask[y * width + x] = 0
      }
    }
  }

  // Low fill or heavy spill means the animal was small, dark, or half hidden and
  // the cutout should not be trusted silently — the studio turns this into a
  // prompt to click the pet rather than quietly measuring a floor.
  const uncertain = Boolean(bounds) && (bestFill < 0.30 || bestSpill > 1.0)
  return { mask, width, height, score: scores[bestIndex], fill: bestFill, spill: bestSpill, uncertain }
}

/// The whole automatic path for one photograph: find the animal, cut it out.
/// Returns null when there is no animal in the frame, which is itself useful —
/// it is how the studio can say "there's no pet in this one" instead of silently
/// measuring a sofa.
export async function readPhoto (image) {
  const found = await detectPet(image)
  if (!found) return null
  const cut = await segmentWithSam(image, { box: found.box })
  return { ...found, ...cut, maskScore: cut.score }
}
