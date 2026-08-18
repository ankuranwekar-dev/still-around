// Turns an appearance into colour.
//
// In the very first version this file was two hand-written cats. Here every
// marking is driven by a parameter, so the same code has to produce a solid
// black cat, a ginger tabby with a white blaze, a calico, a tuxedo, and a golden
// retriever. That generality is the whole reason this can work for a stranger's
// pet rather than only for the two cats it was built for.

import { Part } from './raster.js'
import { CoatPattern, Species, darkened, lightened, luminance, fromHex } from './appearance.js'
import { fbm } from './noise.js'

export const Material = {
  coat: 0, coatDark: 1, accent: 2, accentDark: 3, white: 4,
  earInner: 5, nose: 6, iris: 7, eyeRim: 8, pupil: 9, shine: 10, mouth: 11, lip: 12,
  collar: 13, bell: 14,
  COUNT: 15,
}

// A coat's shadow stops and its silhouette outline both darken the base colour,
// and for an already-dark coat that darkening has nowhere to go but toward pure
// black — which is darker than most things this renders onto: the app's own dark
// theme, the desktop overlay, a photo wallpaper behind it. A solid black cat's
// underside then reads as a hole in the picture rather than as fur in shadow.
// This floors luminance at a low but non-zero value, added evenly across
// channels so it raises brightness without meaningfully shifting hue. It only
// matters for coats already near this floor; everything else is unaffected.
const SHADOW_FLOOR = 0.10
function floored (c) {
  const short = SHADOW_FLOOR - luminance(c)
  if (short <= 0) return c
  return { r: Math.min(1, c.r + short), g: Math.min(1, c.g + short), b: Math.min(1, c.b + short) }
}

export function makeCoat (a) {
  // Four-stop ramps, lightest to darkest. The painter interpolates across them
  // continuously rather than snapping to a step.
  const ramp = (c, lighten = 0.30, darken = 0.46) => {
    const l = lightened(c, lighten)
    const d1 = floored(darkened(c, darken * 0.5))
    const d2 = floored(darkened(c, darken))
    return [
      [l.r, l.g, l.b],
      [c.r, c.g, c.b],
      [d1.r, d1.g, d1.b],
      [d2.r, d2.g, d2.b],
    ]
  }

  // A dark animal's ear insides and nose are dark too; a pale one's are pink.
  // Blending against coat lightness keeps that automatic.
  const lightness = luminance(a.base)
  const pink = fromHex(0xe8aea4)
  const towardCoat = (c, amount) => ({
    r: c.r + (a.base.r - c.r) * amount,
    g: c.g + (a.base.g - c.g) * amount,
    b: c.b + (a.base.b - c.b) * amount,
  })
  const innerEar = towardCoat(pink, Math.max(0, 0.75 - lightness))

  const ramps = new Array(Material.COUNT)
  ramps[Material.coat] = ramp(a.base)
  ramps[Material.coatDark] = ramp(darkened(a.base, 0.42), 0.18)
  ramps[Material.accent] = ramp(a.accent)
  ramps[Material.accentDark] = ramp(darkened(a.accent, 0.40), 0.18)
  ramps[Material.white] = [
    [1.000, 0.996, 0.976], [0.961, 0.937, 0.898],
    [0.878, 0.851, 0.800], [0.760, 0.729, 0.667],
  ]
  ramps[Material.earInner] = ramp(innerEar)
  ramps[Material.nose] = ramp(a.nose)
  ramps[Material.iris] = ramp(a.eye, 0.24, 0.42)
  ramps[Material.eyeRim] = ramp(darkened(a.base, 0.62), 0.22)
  ramps[Material.pupil] = ramp(fromHex(0x241f1b), 0.06, 0.4)
  ramps[Material.shine] = [[1, 1, 1], [0.98, 0.97, 0.94], [0.94, 0.92, 0.87], [0.87, 0.84, 0.78]]
  ramps[Material.mouth] = ramp(darkened(a.base, 0.66), 0.2)
  ramps[Material.lip] = ramp(fromHex(0xdd968f))
  ramps[Material.collar] = ramp(a.collar ? a.collar.colour : fromHex(0x8a8783))
  ramps[Material.bell] = ramp(fromHex(0xe8c04a))

  const patchThreshold = 0.75 - a.patchiness * 0.32
  const stripeThreshold = 1.0 - a.patternContrast * 1.45
  const out = floored(darkened(a.base, 0.72))

  /// Is this spot one of the warm patches of a tortoiseshell?
  const warmAt = (x, y) => a.patchiness > 0.05 && fbm(x, y) > patchThreshold
  const striped = phase => a.patternContrast > 0.05 && Math.sin(phase) > stripeThreshold
  const colourOrAccent = (x, y) => (warmAt(x, y) ? Material.accent : Material.coat)
  const darkOf = m => (m === Material.accent ? Material.accentDark : Material.coatDark)
  /// Siamese-style bodies are a washed-out version of the point colour.
  const paleBody = () => Material.white

  function headMaterial (u, v) {
    // A white stripe up the centre of the face, widening toward the nose.
    if (a.faceBlaze > 0.02) {
      const half = a.faceBlaze * (0.12 + Math.max(0, u - 0.04) * 0.34)
      if (Math.abs(v) < half) return Material.white
    }

    // White chin and lower muzzle. More cap coverage pushes it lower.
    const chinLine = 0.55 + a.capCoverage * 0.40
    if (u > chinLine) return Material.white

    if (a.pattern === CoatPattern.pointed) {
      // Colour is concentrated on the face mask itself.
      const d = Math.hypot(v / 0.9, (u - 0.5) / 0.55)
      if (d > 1) return paleBody()
      return striped(u * 20) ? Material.coatDark : Material.coat
    }

    // How far the colour reaches across the skull. At full coverage the whole
    // head is coloured; at low coverage only a patch on top survives.
    const rx = 0.35 + a.capCoverage * 0.95
    const ry = 0.30 + a.capCoverage * 0.95
    if (Math.hypot(v / rx, (u - 0.30) / ry) > 1) return Material.white

    const warm = warmAt(v * 2.6 + 3.1, u * 2.8)

    // Dark rings around the eye sockets.
    if (a.faceMask > 0.25) {
      const m = Math.hypot((Math.abs(v) - 0.5) / 0.34, (u - 0.44) / 0.2)
      if (m > 0.72 && m < 0.78 + a.faceMask * 0.5) return warm ? Material.accentDark : Material.coatDark
    }

    if (a.pattern === CoatPattern.tabby || a.pattern === CoatPattern.calico) {
      // The forehead M above the eye line, mackerel striping below it.
      if (u < 0.34 && striped(Math.abs(v) * 22)) return warm ? Material.accentDark : Material.coatDark
      if (u >= 0.34 && striped(u * 26 + Math.abs(v) * 4)) return warm ? Material.accentDark : Material.coatDark
    }
    return warm ? Material.accent : Material.coat
  }

  function bodyMaterial (u, v, view) {
    if (a.pattern === CoatPattern.pointed) return paleBody()

    if (view === 'side' || view === 'curl') {
      // u: 0 rear .. 1 shoulder. v: negative above the spine, positive belly.
      // Both guarded, so a fully saddled animal with no chest white comes out
      // genuinely solid rather than leaking a patch.
      if (a.chestWhite > 0.02 && v > 1.0 - a.chestWhite * 1.7) return Material.white
      if (a.saddle < 0.95 && u > 0.2 + a.saddle * 0.78) return Material.white
      const warm = warmAt(u * 3.6, v * 2.2 + 7.5)
      if (striped(u * 24)) return warm ? Material.accentDark : Material.coatDark
      return warm ? Material.accent : Material.coat
    }

    // Sitting, seen head-on: a white bib down the centre of the chest with
    // colour along the flanks. The bib's *width* is the parameter — an earlier
    // version treated chestWhite as a switch, so a dog with a small white patch
    // and a cat with a narrow locket both came out with a fully white front.
    const bib = a.chestWhite * 0.95
    const warm = warmAt(u * 3.2, v * 2.4 + 7.5)
    // An oval sitting high on the chest. A constant-width band instead ran the
    // full height of the animal and looked like a zip fastener.
    if (bib > 0.04 && Math.hypot(v / bib, (u - 0.42) / 0.62) < 1) return Material.white
    if (striped(u * 13)) return warm ? Material.accentDark : Material.coatDark
    return warm ? Material.accent : Material.coat
  }

  function tailMaterial (u) {
    if (a.pattern === CoatPattern.pointed) return u > 0.25 ? darkOf(Material.coat) : paleBody()
    // The very tip is often darker.
    if (a.tailBands > 0.3 && u > 0.9) return Material.coatDark
    if (a.tailBands > 0.1) {
      const band = Math.sin(u * 25)
      if (band > 1 - a.tailBands * 1.6) return warmAt(u * 5.5, 2.4) ? Material.accentDark : Material.coatDark
    }
    if (a.socks > 0.7 && u > 0.88) return Material.white
    return warmAt(u * 5.5, 2.4) ? Material.accent : Material.coat
  }

  function material (part, u, v, view) {
    switch (part) {
      // Fixed regardless of coat pattern.
      case Part.eyeL: case Part.eyeR: return Material.iris
      case Part.eyeRim: return Material.eyeRim
      case Part.pupil: return Material.pupil
      case Part.shine: return Material.shine
      case Part.nose: return Material.nose
      case Part.mouth: case Part.mouthLine: case Part.lid: return Material.mouth
      case Part.lip: return Material.lip
      case Part.earInL: case Part.earInR: return Material.earInner
      case Part.collar: case Part.tag: return Material.collar
      case Part.bell: return Material.bell

      case Part.muzzle:
        if (a.species === Species.dog) {
          // A dog's muzzle carries coat colour. Defaulting it to white — which
          // is right for a cat's chin — gave every dog a painted-on white snout,
          // and was the single worst thing about the first dog render.
          if (a.faceBlaze > 0.35 || a.chestWhite > 0.72) return Material.white
          return warmAt(u * 2.2 + 4.4, v * 2.0) ? Material.accent : Material.coat
        }
        // Cats: white unless the animal has almost no white at all.
        return a.chestWhite < 0.08 && a.capCoverage > 0.92 ? colourOrAccent(u, v) : Material.white

      case Part.head: return headMaterial(u, v)

      case Part.earL: case Part.earR:
        if (a.pattern === CoatPattern.pointed) return darkOf(colourOrAccent(u * 3 + 9, v * 3))
        if (a.capCoverage < 0.25) return Material.white
        return u > 0.78 ? darkOf(colourOrAccent(u, v)) : colourOrAccent(v * 3 + 9, u * 3)

      case Part.body: return bodyMaterial(u, v, view)
      case Part.tail: return tailMaterial(u)

      case Part.legFL: case Part.legFR: case Part.legBL: case Part.legBR: case Part.legFar:
        if (a.pattern === CoatPattern.pointed) return u > 0.45 ? darkOf(Material.coat) : paleBody()
        // u runs top of the leg to the foot, so socks grow from the bottom.
        if (u > 1 - a.socks) return Material.white
        if (a.chestWhite > 0.55) return Material.white
        return striped(u * 22) ? Material.coatDark : Material.coat

      case Part.paw:
        if (a.pattern === CoatPattern.pointed) return darkOf(Material.coat)
        return a.socks > 0.15 || a.chestWhite > 0.55 ? Material.white : Material.coat

      default: return Material.coat
    }
  }

  return {
    appearance: a,
    isDog: a.species === Species.dog,
    ramp: m => ramps[m],
    outline: [out.r, out.g, out.b],
    material,
  }
}
