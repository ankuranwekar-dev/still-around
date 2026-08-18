// Camera, lights, a tiny IBL, a contact shadow. Wide lenses make animals
// cartoonish — 28° vertical is about a 50mm still.

export function setupScene (THREE, { alpha = false } = {}) {
  const scene = new THREE.Scene()
  if (!alpha) scene.background = new THREE.Color(0x1e2228)

  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20)
  camera.position.set(0.55, 0.28, 0.85)
  camera.lookAt(0, 0.14, 0)

  const key = new THREE.DirectionalLight(0xfff2e0, 2.3)
  key.position.set(0.8, 1.4, 0.9)
  scene.add(key)

  const fill = new THREE.DirectionalLight(0xc5d4ff, 0.45)
  fill.position.set(-1.0, 0.3, 0.5)
  scene.add(fill)

  const rim = new THREE.DirectionalLight(0xffe8d2, 1.05)
  rim.position.set(-0.2, 0.9, -1.1)
  scene.add(rim)

  scene.add(new THREE.HemisphereLight(0xdce6f2, 0x3a322c, 0.55))

  // 64px IBL: a gradient cube, not a downloaded HDR. Enough for metal/clearcoat.
  const ibl = makeIbl(THREE)
  scene.environment = ibl

  return { scene, camera, key }
}

export function addContactShadow (THREE, scene, width = 0.22) {
  const geo = new THREE.CircleGeometry(width, 24)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({
    color: 0x2b2118,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  })
  const disc = new THREE.Mesh(geo, mat)
  disc.position.y = 0.001
  disc.name = 'contact-shadow'
  scene.add(disc)
  return disc
}

export function frameCamera (camera, species, view = 'three-quarter') {
  const y = species === 'dog' ? 0.20 : 0.14
  const target = { x: 0, y, z: 0.02 }
  if (view === 'front') camera.position.set(0, y + 0.04, 1.05)
  else if (view === 'profile' || view === 'side') camera.position.set(1.15, y + 0.06, 0.22)
  else if (view === 'back') camera.position.set(0, y + 0.08, -1.05)
  else if (view === 'top') camera.position.set(0.05, 1.2, 0.15)
  else camera.position.set(0.62, y + 0.14, 0.85)
  camera.lookAt(target.x, target.y, target.z)
}

function makeIbl (THREE) {
  const w = 128, h = 64
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = y / h
      const i = (y * w + x) * 4
      data[i] = Math.round(lerp(80, 230, t))
      data[i + 1] = Math.round(lerp(70, 220, t))
      data[i + 2] = Math.round(lerp(65, 235, t))
      data[i + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, w, h)
  tex.needsUpdate = true
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function lerp (a, b, t) { return a + (b - a) * t }
