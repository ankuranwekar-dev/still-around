// Eyes, nose, whiskers. Faces carry likeness; every mistake here has already
// been made once in 2D.

import { muteIris } from './appearance.js'

export function addFace (THREE, group, bones, appearance, profile) {
  const by = Object.fromEntries(bones.map(b => [b.name, b]))
  const iris = muteIris(appearance.eye)
  const eyeMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(iris.r, iris.g, iris.b),
    roughness: 0.18,
    metalness: 0.0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12,
    ior: 1.4,
    transmission: 0.04,
  })
    const cornea = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.18,
  })
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.6 })
  const shineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.2 })

  const eyes = []
  for (const name of ['eye_L', 'eye_R']) {
    const bone = by[name]
    const ball = new THREE.Mesh(new THREE.SphereGeometry(profile.headR * 0.22, 16, 12), eyeMat)
    const pupil = new THREE.Mesh(
      appearance.species === 'dog'
        ? new THREE.SphereGeometry(profile.headR * 0.10, 12, 10)
        : new THREE.SphereGeometry(profile.headR * 0.07, 10, 8),
      pupilMat,
    )
    pupil.position.z = profile.headR * 0.16
    pupil.scale.set(appearance.species === 'dog' ? 1 : 0.55, 1.15, 0.6)
    const shine = new THREE.Mesh(new THREE.SphereGeometry(profile.headR * 0.04, 8, 8), shineMat)
    shine.position.set(-profile.headR * 0.06, profile.headR * 0.06, profile.headR * 0.2)
    const wrap = new THREE.Group()
    wrap.add(ball, pupil, shine)
    wrap.add(new THREE.Mesh(new THREE.SphereGeometry(profile.headR * 0.24, 12, 10), cornea))
    bone.add(wrap)
    wrap.userData.kind = 'eye'
    eyes.push(wrap)
  }

  const noseCol = appearance.nose
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(profile.muzzleR * 0.55, 10, 8),
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(noseCol.r, noseCol.g, noseCol.b),
      roughness: 0.22,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.15,
    }),
  )
  nose.scale.set(1.2, 0.7, 0.9)
  by.jaw.add(nose)
  nose.position.set(0, profile.headH * 0.05, profile.muzzleLen * 0.35)

  // Twelve whiskers a side. Missing whiskers is the fastest route to a cat that
  // looks wrong for reasons nobody can name. Dogs get fewer, shorter.
  const count = appearance.species === 'dog' ? 6 : 12
  const whiskerMat = new THREE.LineBasicMaterial({ color: 0xd8d0c4, transparent: true, opacity: 0.7 })
  const whiskers = new THREE.Group()
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const y = (i / Math.max(1, count - 1) - 0.5) * profile.muzzleR * 1.6
      const len = (appearance.species === 'dog' ? 0.04 : 0.07) * (0.7 + (i % 3) * 0.15)
      const pts = [
        new THREE.Vector3(side * profile.muzzleR * 0.6, y, profile.muzzleLen * 0.2),
        new THREE.Vector3(side * (profile.muzzleR * 0.6 + len), y + 0.004, profile.muzzleLen * 0.15 + len * 0.2),
      ]
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      whiskers.add(new THREE.Line(geo, whiskerMat))
    }
  }
  by.jaw.add(whiskers)

  return {
    eyes,
    setOpen (open) {
      // Floor: linear eye-height scaling collapses squints into dark smudges.
      const h = 0.42 + 0.58 * Math.max(0, Math.min(1.35, open))
      // Both eyes share a phase. Driving two blend shapes independently shipped
      // as one eye open and one shut.
      for (const eye of eyes) eye.scale.set(1, open < 0.12 ? 0.08 : h, 1)
    },
  }
}
