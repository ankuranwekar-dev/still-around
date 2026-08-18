// How a pet looks, as numbers.
//
// This is the heart of the whole project. The original desktop version had two
// cats whose markings were hand-written by a person studying photographs, which
// does not generalise to a stranger's pet. So every marking that used to be
// bespoke code is a parameter here: how much of the head is coloured, how wide
// the blaze is, how banded the tail is.
//
// The analyzer fills these in from uploaded photos. The owner then adjusts them,
// because they knew the animal and no measurement ever will.
//
// Roughly thirty numbers, and they are the entire portable definition of a pet —
// which is what lets the website hand a pet to the desktop app as a small file
// with no account and no server in between.

export const Species = { cat: 'cat', dog: 'dog' }
export const CoatPattern = {
  solid: 'solid',
  tabby: 'tabby',
  bicolour: 'bicolour',
  calico: 'calico',
  tuxedo: 'tuxedo',
  pointed: 'pointed',
}
export const EarStyle = { pointed: 'pointed', rounded: 'rounded', folded: 'folded', floppy: 'floppy' }
export const TailStyle = { long: 'long', fluffy: 'fluffy', curled: 'curled', stubby: 'stubby' }

export const patternLabels = {
  solid: 'Solid',
  tabby: 'Tabby',
  bicolour: 'Two colours',
  calico: 'Calico / tortie',
  tuxedo: 'Tuxedo',
  pointed: 'Pointed',
}

// Plain sRGB in 0..1, stored as components so it round-trips through JSON.
export function rgb (r, g, b) {
  return { r, g, b }
}

export function fromHex (hex) {
  if (typeof hex === 'string') hex = parseInt(hex.replace('#', ''), 16)
  return rgb(((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255)
}

export function toHex (c) {
  const h = v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

export function lightened (c, amount) {
  return rgb(c.r + (1 - c.r) * amount, c.g + (1 - c.g) * amount, c.b + (1 - c.b) * amount)
}

export function darkened (c, amount) {
  return rgb(c.r * (1 - amount), c.g * (1 - amount), c.b * (1 - amount))
}

export function luminance (c) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

export function saturation (c) {
  const hi = Math.max(c.r, c.g, c.b)
  const lo = Math.min(c.r, c.g, c.b)
  return hi <= 0 ? 0 : (hi - lo) / hi
}

/// Hue in degrees, 0 = red, 120 = green, 240 = blue.
export function hue (c) {
  const hi = Math.max(c.r, c.g, c.b)
  const lo = Math.min(c.r, c.g, c.b)
  const d = hi - lo
  if (d <= 0) return 0
  let h
  if (hi === c.r) h = (c.g - c.b) / d
  else if (hi === c.g) h = 2 + (c.b - c.r) / d
  else h = 4 + (c.r - c.g) / d
  h *= 60
  return h < 0 ? h + 360 : h
}

/// A plain short-haired tabby cat — what a new pet starts as before any photo.
export function defaultCat () {
  return {
    species: Species.cat,
    size: 1.0,
    build: 0,
    earStyle: EarStyle.pointed,
    snout: 0.35,
    tailStyle: TailStyle.long,
    furLength: 0.25,
    earNotch: 0,
    earNotchOnLeft: true,

    pattern: CoatPattern.tabby,
    base: fromHex(0x9a8674),
    accent: fromHex(0x5c4d3f),
    eye: fromHex(0x9dae72),
    nose: fromHex(0xe3a19b),

    capCoverage: 0.8,
    faceBlaze: 0,
    faceMask: 0,
    saddle: 0.85,
    chestWhite: 0.25,
    socks: 0,
    tailBands: 0,
    patternContrast: 0.55,
    patchiness: 0,

    collar: null,
  }
}

export function defaultDog () {
  return {
    ...defaultCat(),
    species: Species.dog,
    pattern: CoatPattern.solid,
    earStyle: EarStyle.floppy,
    snout: 0.75,
    tailStyle: TailStyle.long,
    size: 1.15,
    build: 0.2,
    base: fromHex(0xc08a4e),
    accent: fromHex(0x8a5c2e),
    eye: fromHex(0x6b4a2e),
    nose: fromHex(0x3a322c),
    capCoverage: 0.9,
    saddle: 0.9,
    chestWhite: 0.2,
    socks: 0,
    patternContrast: 0.04,
  }
}

export function starting (species) {
  return species === Species.dog ? defaultDog() : defaultCat()
}

/// Sprite grid. A bigger animal gets more pixels rather than a chunkier
/// upscale, which is what preserves relative size when two pets share a screen.
///
/// `quality` exists because the browser is not a Mac app: rendering a 300px
/// grid for three hundred frames of animation up front would leave someone
/// staring at a spinner. The studio previews at a lower grid and the desktop
/// app renders full size.
export function gridFor (a, quality = 1) {
  const base = (a.species === Species.dog ? 272 : 256) * quality
  return Math.round((base * (0.82 + 0.36 * a.size)) / 16) * 16
}

/// Stable identity for caching rendered frames. Order matters, so this walks a
/// fixed key list rather than Object.keys, which would reorder on a round-trip
/// through JSON.
const FINGERPRINT_KEYS = [
  'species', 'size', 'build', 'earStyle', 'snout', 'tailStyle', 'furLength',
  'earNotch', 'earNotchOnLeft', 'pattern', 'capCoverage', 'faceBlaze',
  'faceMask', 'saddle', 'chestWhite', 'socks', 'tailBands', 'patternContrast',
  'patchiness',
]

export function fingerprint (a) {
  const parts = FINGERPRINT_KEYS.map(k => {
    const v = a[k]
    return typeof v === 'number' ? v.toFixed(3) : String(v)
  })
  for (const key of ['base', 'accent', 'eye', 'nose']) parts.push(toHex(a[key]))
  parts.push(a.collar ? toHex(a.collar.colour) + (a.collar.hasBell ? 'b' : 't') : '-')
  // FNV-1a: short, stable, and good enough to key a frame cache.
  let h = 0x811c9dc5
  const s = parts.join('|')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
