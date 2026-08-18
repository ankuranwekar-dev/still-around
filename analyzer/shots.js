// Which photographs to ask for, and why those.
//
// Working backwards from the measurements instead of forwards from whatever
// someone happens to have. Each of the ~30 numbers that describe a pet can only
// be read off a photograph that can actually *see* the thing it describes:
//
//   eye colour, nose, how far colour reaches down the face, a white blaze,
//   dark eye rings, ear shape          → only visible face-on
//   coat colours, saddle, stripes, patches, build, size, tail
//                                      → only visible from the side
//   white chest, white front paws      → only visible from the front
//   tail rings, tail shape             → best from behind
//
// Four shots cover all of it, and no fewer will. That is the whole basis of the
// list below: it is not a photography lesson, it is the minimum set of viewpoints
// from which the parameters are observable at all.
//
// Two consequences for the product:
//
//   1. Averaging every measurement over every photo — which is what the first
//      version did — actively destroys information. A face close-up has no
//      opinion about a white chest, and letting it vote on one is noise. Each
//      parameter is now read from the shot that can see it.
//   2. Asking for a named shot is the cheapest possible classifier. When someone
//      fills the slot labelled "their face", the shot type is known exactly, for
//      free. CLIP could label photographs instead, but the smallest usable build
//      is 126 MB against 20 MB for the whole rest of the pipeline, to answer a
//      question the interface can simply ask.

/// A slot in the shot list. `reads` is documentation *and* the contract used when
/// assembling: a parameter is only taken from a shot that lists it.
export const SHOTS = [
  {
    id: 'face',
    title: 'Looking at you',
    hint: 'Their face, straight on. Close enough to see their eyes.',
    essential: true,
    reads: ['eye', 'nose', 'capCoverage', 'faceBlaze', 'faceMask'],
    /// What the person sees. Drawn rather than photographed so there is no other
    /// animal on the page to compare theirs against.
    glyph: 'face',
  },
  {
    id: 'side',
    title: 'From the side',
    hint: 'All of them, side on — standing, walking or lying down.',
    essential: true,
    reads: ['base', 'accent', 'saddle', 'patternContrast', 'patchiness', 'build', 'size', 'furLength'],
    glyph: 'side',
  },
  {
    id: 'front',
    title: 'Sitting, facing you',
    hint: 'Their chest and front paws in view.',
    essential: false,
    reads: ['chestWhite', 'socks'],
    glyph: 'front',
  },
  {
    id: 'tail',
    title: 'Their tail',
    hint: 'From behind, or any photo where the tail shows clearly.',
    essential: false,
    reads: ['tailBands', 'tailStyle'],
    glyph: 'tail',
  },
]

export const ESSENTIAL = SHOTS.filter(s => s.essential).map(s => s.id)

/// Geometry of one cut-out animal, which is all the shot scoring needs.
export function shapeOf (mask, width, height) {
  let minX = width, maxX = -1, minY = height, maxY = -1, area = 0
  let sumX = 0, sumY = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue
      area++
      sumX += x; sumY += y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (area === 0) return null

  const boxW = Math.max(1, maxX - minX + 1)
  const boxH = Math.max(1, maxY - minY + 1)
  return {
    /// Where the animal is, so a thumbnail can crop to it rather than showing a
    /// postage stamp of pet in the middle of a room.
    box: { x: minX, y: minY, w: boxW, h: boxH },
    area,
    aspect: boxW / boxH,
    /// How much of its own bounding box the animal fills. A head is a compact
    /// blob at ~0.7; a standing animal with legs and a tail leaves gaps at ~0.45.
    fill: area / (boxW * boxH),
    /// How much of the photograph it occupies — the giveaway for a close-up.
    coverage: area / (width * height),
    centroidY: sumY / area / height,
  }
}

const clamp01 = v => Math.min(1, Math.max(0, v))
const bell = (v, centre, width) => Math.exp(-((v - centre) ** 2) / (2 * width * width))

/// How well one photograph serves each slot, from shape alone.
///
/// These are deliberately crude. They exist to *sort* a pile of frames from one
/// video — where every frame shows the same animal in the same light, so relative
/// comparison is reliable — and to make a sensible first guess when someone drops
/// photos in bulk. When a person fills a named slot directly, none of this runs.
export function scoreShot (shape) {
  if (!shape) return { face: 0, side: 0, front: 0, tail: 0 }
  const { aspect, fill, coverage } = shape
  return {
    // A close-up: fills the frame, roughly square, compact.
    face: clamp01(coverage / 0.30) * bell(aspect, 1.0, 0.42) * clamp01(fill / 0.60),
    // Longer than tall, and enough of the body visible to read a saddle.
    side: clamp01((aspect - 0.95) / 0.55) * clamp01(fill / 0.42) * clamp01(coverage / 0.06),
    // Taller than wide — sitting, seen head-on.
    front: clamp01((0.95 - aspect) / 0.32) * clamp01(fill / 0.40) * clamp01(coverage / 0.06),
    // A loose silhouette: limbs and a tail leaving gaps in the bounding box.
    tail: clamp01((0.58 - fill) / 0.26) * clamp01((aspect - 0.85) / 0.55),
  }
}

/// Fit a pile of candidates into the slots, best-first.
///
/// Greedy over every (candidate, slot) pair rather than per-slot in order: taking
/// the single most confident pairing each time stops the first slot claiming a
/// frame that is the only usable one for a later slot. One frame per slot, and
/// leftovers are returned so the caller can still measure colour from them.
export function assignShots (candidates) {
  const pairs = []
  candidates.forEach((candidate, index) => {
    const scores = scoreShot(candidate.shape)
    for (const shot of SHOTS) {
      // Sharpness and size break ties: of two frames that both look like a side
      // view, the crisper and larger one is the better measurement.
      const quality = 0.75 + 0.25 * clamp01((candidate.quality ?? 0.5))
      pairs.push({ index, shot: shot.id, score: scores[shot.id] * quality })
    }
  })
  pairs.sort((a, b) => b.score - a.score)

  const filled = {}
  const usedIndex = new Set()
  for (const pair of pairs) {
    if (pair.score <= 0.08) break         // below this it is a guess, not a match
    if (filled[pair.shot] || usedIndex.has(pair.index)) continue
    filled[pair.shot] = candidates[pair.index]
    usedIndex.add(pair.index)
  }

  return {
    filled,
    leftovers: candidates.filter((_, i) => !usedIndex.has(i)),
    missing: ESSENTIAL.filter(id => !filled[id]),
  }
}

/// How to draw each slot's illustration — with our own renderer, posed in exactly
/// the viewpoint being asked for.
///
/// The first version of this was hand-written SVG: a circle, two triangles and two
/// dots for eyes. It read as a mask rather than a cat, and against a dark
/// background it was frankly unpleasant. There was never any need for it — the
/// project contains a renderer that draws charming animals, and using it means the
/// picture beside "from the side" *is* a pet seen from the side, drawn by the same
/// code that will draw theirs.
///
/// `clip` and `frames` give a short loop, so the little cats breathe and blink
/// instead of sitting there. `focus` frames the crop: the face slot zooms to the
/// head, the tail slot leans toward the back end.
export const SLOT_ART = {
  face: { clip: 'blink', frames: [0, 0, 0, 0, 0, 0, 1, 2, 3, 4], view: 'head', facing: 1 },
  side: { clip: 'walk', frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], view: 'body', facing: 1 },
  front: { clip: 'sit', frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], view: 'body', facing: 1 },
  // A whole cat, trotting with its tail up and made deliberately fluffy, so the
  // tail is plainly the subject. Two earlier attempts failed here: a mirrored side
  // view read as a second copy of "from the side", and cropping to the back half
  // produced a headless torso, which is grotesque on a page about someone's dead
  // pet. The animal stays whole; the tail does the talking.
  tail: {
    clip: 'trot', frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], view: 'body', facing: 1,
    pet: { tailStyle: 'fluffy', tailBands: 0.8, furLength: 0.45, patternContrast: 0.12 },
  },
}

/// A soft, friendly, obviously-generic cat for the illustrations. Deliberately not
/// Momo or Belle, and deliberately not vivid: it is a diagram of a viewpoint, and
/// it must not compete with the photograph of the animal someone actually loved.
export const SLOT_PET = {
  base: '#c8a888',
  accent: '#a3805f',
  eye: '#8fa86a',
  nose: '#e0aca4',
  capCoverage: 0.72,
  faceBlaze: 0.32,
  chestWhite: 0.55,
  socks: 0.5,
  patternContrast: 0.18,
  tailBands: 0.3,
  size: 1,
}
