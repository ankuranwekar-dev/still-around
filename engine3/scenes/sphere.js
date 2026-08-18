// Placeholder scene. Proves the headless harness from a cold checkout.
// Not pet art — a lit sphere with a procedural checker so a black frame is
// obvious and UVs, lighting, and the camera path can be judged by looking.

export const name = 'sphere'

export const views = Array.from({ length: 8 }, (_, i) => {
  const deg = i * 45
  return { id: `yaw-${deg}`, label: `${deg}°`, yaw: (deg * Math.PI) / 180, pitch: 0.18 }
})

export function create (THREE) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1e2228)

  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50)

  const key = new THREE.DirectionalLight(0xfff2e0, 2.4)
  key.position.set(2.4, 3.4, 2.2)
  scene.add(key)

  const fill = new THREE.DirectionalLight(0xc5d4ff, 0.5)
  fill.position.set(-2.6, 0.4, 1.4)
  scene.add(fill)

  const rim = new THREE.DirectionalLight(0xffe8d2, 1.15)
  rim.position.set(-0.3, 2.0, -2.8)
  scene.add(rim)

  scene.add(new THREE.AmbientLight(0x6a737d, 0.32))

  const map = checkerMap(THREE)
  const geometry = new THREE.SphereGeometry(0.72, 64, 48)
  const material = new THREE.MeshStandardMaterial({
    map,
    roughness: 0.42,
    metalness: 0.04,
  })
  const mesh = new THREE.Mesh(geometry, material)
  scene.add(mesh)

  return {
    scene,
    camera,
    subject: mesh,
    setView (view) {
      const radius = 2.65
      const yaw = view.yaw ?? 0
      const pitch = view.pitch ?? 0.18
      camera.position.set(
        Math.sin(yaw) * Math.cos(pitch) * radius,
        Math.sin(pitch) * radius,
        Math.cos(yaw) * Math.cos(pitch) * radius,
      )
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
    },
    tick (t) {
      mesh.rotation.y = t * Math.PI * 2
    },
    dispose () {
      geometry.dispose()
      material.dispose()
      map.dispose()
    },
  }
}

function checkerMap (THREE) {
  const size = 512
  const cells = 8
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const light = '#e8d7b8'
  const dark = '#6b4a2e'
  const cell = size / cells
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? light : dark
      ctx.fillRect(x * cell, y * cell, cell, cell)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}
