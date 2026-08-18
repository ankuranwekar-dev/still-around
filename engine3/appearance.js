// Appearance v2: v1 numbers plus morphs and fur density. Photos are still not
// in this file. A v1 pet opens by filling morphs with 0 (the base mesh).

import { starting, Species, hue, saturation, luminance } from '../engine/appearance.js'
import { zeroMorphs } from './species/profiles.js'

export function migratePet (pet) {
  if (!pet || typeof pet !== 'object') throw new Error('The file is not a pet.')
  const src = pet.appearance && typeof pet.appearance === 'object' ? pet.appearance : pet
  const species = src.species === Species.dog ? Species.dog : Species.cat
  const appearance = {
    ...starting(species),
    ...src,
    morphs: { ...zeroMorphs(), ...(src.morphs || {}) },
    furDensity: src.furDensity ?? 0.62,
  }
  if (!appearance.undercoat) {
    appearance.undercoat = {
      r: appearance.base.r * 0.82 + 0.08,
      g: appearance.base.g * 0.82 + 0.08,
      b: appearance.base.b * 0.82 + 0.06,
    }
  }
  appearance.base = clampFurGamut(appearance.base)
  appearance.accent = clampFurGamut(appearance.accent)
  appearance.eye = muteIris(appearance.eye)
  return {
    format: 'still-around/pet',
    version: 2,
    name: typeof pet.name === 'string' && pet.name.trim() ? pet.name.trim().slice(0, 40) : 'My pet',
    appearance,
  }
}

export function toPetFile (name, appearance) {
  return migratePet({ format: 'still-around/pet', version: 2, name, appearance })
}

/// Fur gamut: near-neutral, or warm between about 12° and 60°. Saturated greens
/// are floors; saturated pure reds are beds. Lives in the material path, not
/// only in the analyzer.
export function clampFurGamut (c) {
  const s = saturation(c)
  const h = hue(c)
  if (s < 0.12) return c
  if (s > 0.45 && h < 15) {
    return { r: lerp(c.r, 0.45, 0.55), g: lerp(c.g, 0.32, 0.55), b: lerp(c.b, 0.28, 0.55) }
  }
  if ((h >= 12 && h <= 60) || h >= 340) return c
  const t = 0.55
  return { r: lerp(c.r, 0.55, t), g: lerp(c.g, 0.42, t), b: lerp(c.b, 0.32, t) }
}

export function muteIris (c) {
  const s = saturation(c)
  if (s < 0.28) return c
  const k = 0.28 / s
  const l = luminance(c)
  return {
    r: lerp(l, c.r, k),
    g: lerp(l, c.g, k),
    b: lerp(l, c.b, k),
  }
}

function lerp (a, b, t) { return a + (b - a) * t }
