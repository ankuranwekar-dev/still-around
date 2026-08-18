// The animation library.
//
// Everything in the rig is a number, so an animation is a function of phase. No
// keyframe tables, no sprite sheets — change a coefficient and the whole cycle
// updates. `speed` is how far the pet travels while the clip plays, in the
// stage's own units per second.

import { pose } from './rig.js'

const TAU = Math.PI * 2
const wave = (t, off = 0) => Math.sin(t * TAU + off)
/// 0 -> 1 -> 0 across the clip.
const bump = t => Math.sin(t * Math.PI)

const A = (name, frames, fps, loops, speed, fn) => ({ name, frames, fps, loops, speed, pose: fn, duration: frames / fps })

export const list = [
  // MARK: Resting
  A('sit', 16, 8, true, 0, t => pose({
    view: 'front',
    breathe: wave(t) * 0.8,
    bodyY: wave(t) * 0.3,
    headY: wave(t, 0.6) * 0.25,
    tailPhase: t * TAU,
    tailWave: 0.05,
  })),

  A('blink', 6, 16, false, 0, t => pose({
    view: 'front',
    eyeOpen: Math.max(0, 1 - bump(t) * 1.5),
  })),

  // The slow blink an animal gives someone it trusts. Held, not flicked.
  A('slowBlink', 20, 12, false, 0, t => pose({
    view: 'front',
    eyeOpen: t < 0.25 ? 1 - t / 0.25 : (t < 0.7 ? 0 : (t - 0.7) / 0.3),
    headY: -bump(t) * 0.4,
    earL: bump(t) * 0.08,
    earR: bump(t) * 0.08,
  })),

  A('lookAround', 32, 8, false, 0, t => pose({
    view: 'front',
    lookX: Math.sin(t * TAU * 1.5),
    headX: Math.sin(t * TAU * 1.5) * 1.4,
    headTilt: Math.sin(t * TAU * 1.5) * 0.06,
    breathe: wave(t * 2) * 0.6,
    tailPhase: t * TAU,
    tailWave: 0.08,
  })),

  A('groom', 24, 10, true, 0, t => pose({
    view: 'front',
    headLow: 0.55 + wave(t * 3) * 0.14,
    headTilt: 0.16,
    frontPawReach: 0.6,
    eyeOpen: 0.35,
    mouthOpen: 0.35 + wave(t * 3) * 0.25,
    tailPhase: t * TAU,
    tailWave: 0.06,
  })),

  A('loaf', 20, 6, true, 0, t => pose({
    view: 'side',
    tuck: 1,
    eyeOpen: 0.45,
    breathe: wave(t) * 0.6,
    bodyY: wave(t) * 0.25,
    tailPhase: t * TAU,
    tailWave: 0.03,
    tailBase: -0.35,
  })),

  A('sleep', 32, 5, true, 0, t => pose({
    view: 'curl',
    eyeOpen: 0,
    bodyY: wave(t) * 0.5,
    headY: wave(t, 0.4) * 0.35,
    earL: t > 0.82 && t < 0.88 ? 0.5 : 0.2, // a twitch — dreaming
    tailBase: -0.5,
    tailPhase: t * TAU * 0.5,
    tailWave: 0.02,
  })),

  A('wake', 24, 8, false, 0, t => pose({
    view: 'curl',
    eyeOpen: Math.min(1, t * 1.6),
    headY: -t * 2.5,
    earL: 0.3 * (1 - t),
    earR: 0.2 * (1 - t),
  })),

  A('stretch', 22, 10, false, 0, t => {
    const s = bump(t)
    return pose({
      view: 'side',
      stretch: s,
      headLow: s * 0.35,
      eyeOpen: 1 - s * 0.8,
      mouthOpen: s > 0.6 ? (s - 0.6) * 2 : 0,
      tailBase: s * 0.8,
      tailCurve: 0.22,
    })
  }),

  // MARK: In motion
  A('walk', 12, 12, true, 26, t => pose({
    view: 'side',
    gait: 1,
    legPhase: t * TAU,
    tailBase: 0.35,
    tailPhase: t * TAU,
    tailWave: 0.09,
    headY: wave(t * 2) * 0.35,
  })),

  A('trot', 10, 18, true, 74, t => pose({
    view: 'side',
    gait: 1.5,
    legPhase: t * TAU,
    crouch: 0.25,
    tailBase: 0.7,
    tailPhase: t * TAU,
    tailWave: 0.13,
    headY: wave(t * 2) * 0.5,
    earL: 0.12,
    earR: 0.12,
  })),

  A('pounce', 18, 16, false, 0, t => {
    if (t < 0.45) {
      // Crouch and wiggle.
      return pose({
        view: 'side',
        crouch: 0.9,
        bodyY: Math.sin(t * TAU * 6) * 0.4,
        eyeOpen: 1.25,
        earL: 0.1,
        earR: 0.1,
        tailWave: 0.3,
        tailPhase: t * TAU * 4,
      })
    }
    const l = (t - 0.45) / 0.55
    return pose({
      view: 'side',
      bodyY: -bump(l) * 9,
      crouch: 0.2,
      gait: 0.5,
      legPhase: Math.PI / 2,
      eyeOpen: 1.2,
      tailBase: 0.9,
    })
  }),

  // MARK: Reactions
  A('speak', 14, 14, false, 0, t => pose({
    view: 'front',
    mouthOpen: bump(t),
    headY: -bump(t) * 0.8,
    headTilt: 0.04,
    breathe: bump(t) * 0.6,
    eyeOpen: 1 - bump(t) * 0.12,
  })),

  A('purr', 12, 20, true, 0, t => pose({
    view: 'front',
    eyeOpen: 0.06,
    // The vibration you can feel through a purring animal.
    bodyY: wave(t * 3) * 0.35,
    headY: wave(t * 3, 1) * 0.3,
    earL: 0.12,
    earR: 0.12,
    breathe: wave(t) * 0.8,
  })),

  A('knead', 16, 9, true, 0, t => pose({
    view: 'front',
    eyeOpen: 0.2,
    frontPawReach: 0.5 + wave(t) * 0.5,
    bodyY: wave(t) * 0.4,
    headTilt: wave(t) * 0.05,
  })),

  A('startle', 14, 18, false, 0, t => {
    const s = bump(t)
    return pose({
      view: 'front',
      eyeOpen: 1 + s * 0.4,
      earL: s,
      earR: s,
      bodyY: -s * 2.2,
      crouch: s * 0.3,
      tailWave: s * 0.4,
      tailPhase: t * TAU * 3,
      tailBase: s * 0.5,
    })
  }),

  /// Looks straight at you and holds it.
  A('attend', 20, 8, true, 0, t => pose({
    view: 'front',
    eyeOpen: 1.15,
    headTilt: wave(t) * 0.05,
    tailPhase: t * TAU,
    tailWave: 0.16,
    breathe: wave(t) * 0.5,
  })),
]

export const all = Object.fromEntries(list.map(a => [a.name, a]))

export function named (name) {
  return all[name] || all.sit
}

/// Everything the stage might play, in the order worth pre-rendering: what shows
/// first comes first, so the pet appears while the rest is still being built.
export const PREWARM = [
  'sit', 'blink', 'slowBlink', 'speak', 'lookAround', 'loaf', 'groom', 'walk',
  'purr', 'sleep', 'attend', 'stretch', 'trot', 'wake', 'startle', 'knead', 'pounce',
]
