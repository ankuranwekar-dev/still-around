// How good a photograph actually is for drawing an animal from.
//
// The likeness is only ever as good as what it was measured from, and until now
// the person had no way to know a photo was letting them down until the pet came
// out wrong at the end — by which point they cannot tell which of four photos was
// at fault. This scores each one as it arrives, and says what is wrong in terms of
// something they can do about it: get closer, hold still, try a plainer wall.
//
// Every factor here is measured, not guessed. The score is the weighted mean of
// them, with hard caps for the two failures that no amount of good elsewhere can
// make up for: not finding the animal cleanly, and it being too small to sample.

const clamp01 = v => Math.min(1, Math.max(0, v))

/// Luminance, matching the analyzer's own weighting.
const lumaAt = (data, i) =>
  (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255

/// Mean absolute Laplacian inside the mask — a blur measure. A photograph of a
/// moving cat in low light is smooth; fur in focus is not. Interior pixels only,
/// or the mask's own edge reads as detail no matter how soft the photo is.
function sharpness (small, mask) {
  const { width: w, height: h, data } = small
  let sum = 0, n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (!mask[i] || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) continue
      const l = lumaAt(data, i)
      const lap = 4 * l - lumaAt(data, i - 1) - lumaAt(data, i + 1)
                        - lumaAt(data, i - w) - lumaAt(data, i + w)
      sum += Math.abs(lap)
      n++
    }
  }
  if (!n) return 0
  // 0.045 is roughly where a hand-held indoor photo of a cat sits when it is in
  // focus; below about a third of that the coat has no texture left to read.
  return clamp01((sum / n) / 0.045)
}

/// Fraction of the animal that is blown out or crushed. Either end destroys the
/// colour: white fur at 255 has no hue, and black fur at 0 has none either.
function clipped (small, mask) {
  const { data } = small
  let bad = 0, n = 0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const l = lumaAt(data, i)
    if (l > 0.96 || l < 0.04) bad++
    n++
  }
  return n ? bad / n : 1
}

/// How much of the animal is pressed against the edge of the frame. A cat with
/// its back half outside the photo cannot have its saddle or tail measured.
function cropping (small, mask, shape) {
  const { width: w, height: h } = small
  const b = shape.box
  let touching = 0
  for (let x = b.x; x < b.x + b.w; x++) {
    if (mask[x]) touching++
    if (mask[(h - 1) * w + x]) touching++
  }
  for (let y = b.y; y < b.y + b.h; y++) {
    if (mask[y * w]) touching++
    if (mask[y * w + w - 1]) touching++
  }
  const perimeter = 2 * (b.w + b.h)
  return clamp01(touching / Math.max(1, perimeter))
}

/// Score one prepared shot for the slot it is going into.
///
/// `slot` is a SHOTS id, or null to score it on its own merits without asking
/// whether the pose suits a particular slot.
export function scoreCapture (shot, slot = null, poseScores = null) {
  if (!shot || !shot.shape) {
    return { score: 0, verdict: 'poor', reasons: ['No animal found in this one.'] }
  }

  const { small, mask, shape, uncertain } = shot

  // --- the measurements
  const size = clamp01(shape.coverage / 0.10)
  const sharp = sharpness(small, mask)
  const blown = clipped(small, mask)
  const exposure = clamp01(1 - blown / 0.30)
  const edge = cropping(small, mask, shape)
  const framing = clamp01(1 - (edge - 0.12) / 0.45)
  // Pose only counts when we know which slot this is meant to be, and even then
  // gently: someone who says "this is the side one" has better information about
  // their own cat than a shape heuristic does.
  const pose = slot && poseScores ? clamp01(poseScores[slot] / 0.55) : 1

  // --- combine
  //
  // Not a plain weighted mean: that let one ruinous fault hide behind four good
  // ones. A blurred photograph measured 0.25 for sharpness and still scored 82%,
  // which is exactly the kind of confident wrong answer this whole feature exists
  // to stop. So the weakest factor drags the whole score down with it.
  const factors = [
    { v: size, w: 0.30, why: 'They are small in the frame — get closer, or crop in on them.' },
    { v: sharp, w: 0.22, why: 'A little soft — one where they are holding still will read better.' },
    { v: exposure, w: 0.18, why: 'The light is washing their coat out — softer, more even light helps.' },
    { v: framing, w: 0.15, why: 'They are running off the edge of the photo — leave a bit of room around them.' },
    { v: pose, w: 0.15, why: 'The angle is not quite what this slot wants — see the drawing for the pose.' },
  ]
  const mean = factors.reduce((sum, f) => sum + f.w * f.v, 0)
  const worst = Math.min(...factors.map(f => f.v))
  const score = mean * (0.55 + 0.45 * worst)

  // Worst first, so the sentence they read is about the thing most worth fixing.
  const reasons = factors
    .filter(f => f.v < 0.72)
    .sort((a, b) => a.v - b.v)
    .map(f => f.why)
  if (uncertain) {
    reasons.unshift('Hard to separate them from the background — a plainer wall or floor helps.')
  }

  // Two failures nothing else can compensate for: a cutout we do not trust, and an
  // animal too small to take colour from. Capped rather than subtracted, so the
  // number cannot look respectable on the strength of the other factors.
  let capped = score
  if (uncertain) capped = Math.min(capped, 0.45)
  if (shape.coverage < 0.02) capped = Math.min(capped, 0.35)

  const verdict = capped >= 0.80 ? 'great' : capped >= 0.50 ? 'ok' : 'poor'
  if (!reasons.length) reasons.push('Clear and close — this will read well.')
  return { score: capped, verdict, reasons }
}
