// Body-space coat → vertex colours. Markings stay glued to u/v/region, never
// screen space. Reuses engine/coat.js so a blaze, saddle, socks and tabby
// stripes mean the same thing they meant in 2D.

import { makeCoat } from '../engine/coat.js'
import { clampFurGamut, muteIris } from './appearance.js'

export function paintCoat (THREE, mesh, appearance) {
  const a = {
    ...appearance,
    base: clampFurGamut(appearance.base),
    accent: clampFurGamut(appearance.accent),
    eye: muteIris(appearance.eye),
  }
  const coat = makeCoat(a)
  const geo = mesh.geometry
  const n = geo.attributes.position.count
  const uv = geo.attributes.uv
  const region = geo.attributes.region
  const arr = new Float32Array(n * 3)
  const under = a.undercoat || a.base
  for (let i = 0; i < n; i++) {
    const u = uv.getX(i)
    const v = uv.getY(i) * 2 - 1
    const part = region.getX(i)
    const mat = coat.material(part, u, v, 'side')
    const mid = coat.ramp(mat)[1]
    // Two-layer coat: undercoat in the creases (belly / inside), guard colour
    // on the rest. Real fur is not a painted shell.
    const belly = Math.max(0, 0.35 - (v + 1) * 0.5) * 1.4
    const k = Math.min(1, belly * 0.45)
    arr[i * 3] = mid[0] * (1 - k) + under.r * k
    arr[i * 3 + 1] = mid[1] * (1 - k) + under.g * k
    arr[i * 3 + 2] = mid[2] * (1 - k) + under.b * k
  }
  if (geo.attributes.color) geo.attributes.color.array.set(arr)
  else geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3))
  geo.attributes.color.needsUpdate = true
  mesh.material.vertexColors = true
  mesh.material.color.set(1, 1, 1)
  mesh.material.needsUpdate = true
}
