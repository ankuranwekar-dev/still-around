// One animal, from an appearance. Rebuilds when morphs change; paints when
// coat numbers change. The overlay and the studio both import this.

import { buildSpecies } from './mesh.js'
import { paintCoat } from './coat3.js'
import { addFur, dragFur, LOD } from './fur.js'
import { addFace } from './face.js'
import { applyPose } from './motion.js'
import { migratePet } from './appearance.js'
import { named } from '../engine/poses.js'

export function createPet (THREE, appearance, { lod = 0 } = {}) {
  const pet = migratePet({ appearance })
  const a = pet.appearance
  const built = buildSpecies(THREE, a.species, a.morphs)
  paintCoat(THREE, built.mesh, a)
  const face = addFace(THREE, built.mesh, built.bones, a, built.profile)
  const shells = addFur(THREE, built.mesh, a, lod)

  const root = new THREE.Group()
  root.add(built.mesh)
  for (const s of shells) root.add(s)
  root.userData.species = a.species

  let clipName = 'sit'
  let clipTime = 0
  let facing = 1
  let prevX = 0

  function poseNow () {
    const clip = named(clipName)
    const t = clip.duration > 0 ? (clipTime % (clip.loops ? Math.max(clip.duration, 0.01) : clip.duration)) / clip.duration : 0
    const p = clip.pose(Math.min(0.999, Math.max(0, t)))
    p.facing = facing
    applyPose(built.bones, p, built.profile, facing)
    face.setOpen(p.eyeOpen)
    built.skeleton.bones.forEach(b => b.updateMatrix())
    built.mesh.skeleton.update()
    return p
  }

  poseNow()

  return {
    root,
    mesh: built.mesh,
    appearance: a,
    play (name, dir = facing) {
      clipName = name
      clipTime = 0
      facing = dir
      const view = named(name).pose(0).view
      if (view === 'side') root.rotation.y = (dir > 0 ? 1 : -1) * Math.PI / 2
      else if (view === 'curl') root.rotation.y = 0.55
      else root.rotation.y = 0
    },
    tick (dt) {
      const clip = named(clipName)
      clipTime += dt
      if (!clip.loops && clipTime >= clip.duration) clipTime = clip.duration
      poseNow()
      const x = root.position.x
      dragFur(built.mesh, x - prevX, 0, 0)
      prevX = x
    },
    setLod (next) {
      const shells = built.mesh.userData.furShells || []
      const n = (LOD[next] || LOD[1]).shells
      shells.forEach((s, i) => { s.visible = i < n })
    },
    setOpen: face.setOpen,
    get clip () { return clipName },
    dispose () {
      built.mesh.geometry.dispose()
      built.mesh.material.dispose()
      for (const s of built.mesh.userData.furShells || []) {
        s.geometry.dispose()
        s.material.dispose()
      }
    },
  }
}
