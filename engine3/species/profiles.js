// Species bind-pose proportions.
//
// A dog is not a cat with different ears. These two profiles are authored as
// separate skeletons: dogs stand clear of the ground, carry a deep chest over a
// tucked waist, slope from withers to hip, and bend the back leg at the hock.
// Cats are compact, with a rounder skull and a tail that does real work in the
// silhouette.

export const MORPH_NAMES = [
  'skullWidth', 'muzzleLength', 'muzzleDepth', 'earSet', 'earSize', 'earFold',
  'neckThickness', 'chestDepth', 'waistTuck', 'backLength', 'toplineSlope',
  'legLength', 'hockAngle', 'pawSize', 'tailLength', 'tailFluff', 'bodyMass',
  'cheekFluff',
]

export const zeroMorphs = () => Object.fromEntries(MORPH_NAMES.map(n => [n, 0]))

/// Cat, standing, metres. Origin at the ground under the chest. Faces +Z.
export function felisProfile (m = {}) {
  const g = (k, d) => d + (m[k] || 0) * d * (k === 'earFold' || k === 'tailFluff' || k === 'cheekFluff' ? 1 : 0.45)
  return {
    species: 'cat',
    height: 0.24 + (m.legLength || 0) * 0.05,
    bodyLen: 0.30 + (m.backLength || 0) * 0.08,
    chestR: 0.055 + (m.chestDepth || 0) * 0.018 + (m.bodyMass || 0) * 0.012,
    waistR: 0.048 - (m.waistTuck || 0) * 0.01 + (m.bodyMass || 0) * 0.01,
    hipR: 0.050 + (m.bodyMass || 0) * 0.01,
    topline: 0.012 + (m.toplineSlope || 0) * 0.02,
    neckLen: 0.045,
    neckR: 0.028 + (m.neckThickness || 0) * 0.01,
    headR: 0.046 + (m.skullWidth || 0) * 0.012 + (m.cheekFluff || 0) * 0.008,
    headH: 0.042,
    muzzleLen: 0.032 + (m.muzzleLength || 0) * 0.02,
    muzzleR: 0.020 + (m.muzzleDepth || 0) * 0.008,
    earH: 0.048 * (1 + (m.earSize || 0) * 0.4),
    earW: 0.018,
    earSet: 0.70 + (m.earSet || 0) * 0.15,
    earFold: m.earFold || 0,
    floppy: false,
    legLen: 0.10 + (m.legLength || 0) * 0.04,
    hock: 0.28 + (m.hockAngle || 0) * 0.15,
    pawR: 0.016 * (1 + (m.pawSize || 0) * 0.4),
    tailLen: 0.26 + (m.tailLength || 0) * 0.08,
    tailR: 0.011 * (1 + (m.tailFluff || 0) * 0.8),
    tailSegs: 8,
  }
}

/// Dog, standing. The numbers that decide the silhouette are leg length, chest
/// depth, waist tuck, topline slope, and hock — not the ears.
export function canisProfile (m = {}) {
  return {
    species: 'dog',
    height: 0.36 + (m.legLength || 0) * 0.08,
    bodyLen: 0.42 + (m.backLength || 0) * 0.12,
    chestR: 0.078 + (m.chestDepth || 0) * 0.022 + (m.bodyMass || 0) * 0.014,
    waistR: 0.046 - (m.waistTuck || 0) * 0.014 + (m.bodyMass || 0) * 0.01,
    hipR: 0.058 + (m.bodyMass || 0) * 0.012,
    topline: 0.048 + (m.toplineSlope || 0) * 0.03,
    neckLen: 0.09,
    neckR: 0.032 + (m.neckThickness || 0) * 0.012,
    headR: 0.040 + (m.skullWidth || 0) * 0.012 + (m.cheekFluff || 0) * 0.006,
    headH: 0.038,
    muzzleLen: 0.085 + (m.muzzleLength || 0) * 0.04,
    muzzleR: 0.024 + (m.muzzleDepth || 0) * 0.01,
    earH: 0.075 * (1 + (m.earSize || 0) * 0.35),
    earW: 0.022,
    earSet: 0.82 + (m.earSet || 0) * 0.12,
    earFold: m.earFold || 0,
    floppy: true,
    legLen: 0.19 + (m.legLength || 0) * 0.06,
    hock: 0.58 + (m.hockAngle || 0) * 0.2,
    pawR: 0.018 * (1 + (m.pawSize || 0) * 0.4),
    tailLen: 0.22 + (m.tailLength || 0) * 0.08,
    tailR: 0.013 * (1 + (m.tailFluff || 0) * 0.9),
    tailSegs: 8,
  }
}

export function profileFor (species, morphs) {
  return species === 'dog' ? canisProfile(morphs) : felisProfile(morphs)
}
