// One entry point for the whole art engine, shared verbatim between the website
// and the desktop apps. Nothing in here touches the DOM, the filesystem, or the
// network, which is what lets the same file run in a browser, in a Web Worker,
// in Electron, and under plain Node for the test harness.

export * from './appearance.js'
export * as Raster from './raster.js'
export * as Rig from './rig.js'
export * as Poses from './poses.js'
export { Material, makeCoat } from './coat.js'
export { paint } from './painter.js'
export { Part } from './raster.js'

import { rasterize } from './raster.js'
import { build, pose as makePose } from './rig.js'
import { makeCoat } from './coat.js'
import { paint } from './painter.js'
import { named } from './poses.js'

/// Render one frame. Returns { rgba, size } — straight RGBA, ready for an
/// ImageData or a PNG encoder.
export function renderFrame (appearance, { animation = 'sit', frame = 0, facing = 1, quality = 1 } = {}) {
  const clip = named(animation)
  const t = clip.frames > 1 ? frame / clip.frames : 0
  const p = clip.pose(t)
  p.facing = facing
  const { layers, meta, grid } = build(p, appearance, quality)
  const map = rasterize(layers, grid)
  // The meta comes back with the image because a caller that wants to frame the
  // head — an avatar, an illustration of "looking at you" — needs to know where
  // the head actually ended up, and only the rig knows that.
  return { ...paint(map, makeCoat(appearance), meta), meta }
}

/// Render a whole clip. `onFrame` is called as each frame lands so a caller can
/// show progress instead of blocking on the full set.
export function renderClip (appearance, animation, { facing = 1, quality = 1, onFrame = null } = {}) {
  const clip = named(animation)
  const coat = makeCoat(appearance)
  const frames = []
  for (let f = 0; f < clip.frames; f++) {
    const p = clip.pose(f / clip.frames)
    p.facing = facing
    const { layers, meta, grid } = build(p, appearance, quality)
    const image = paint(rasterize(layers, grid), coat, meta)
    frames.push(image)
    if (onFrame) onFrame(f, clip.frames, image)
  }
  return { name: clip.name, fps: clip.fps, loops: clip.loops, speed: clip.speed, frames }
}

export { makePose }
