// Layered shells. Fins and cards come later; at overlay size the silhouette is
// won by extruding along normals with an outward alpha ramp. LOD is shell count.
// Fur drag offsets extrusion by recent bone velocity.

export const LOD = {
  0: { shells: 4, cards: false },
  1: { shells: 8, cards: true },
  2: { shells: 12, cards: true },
  3: { shells: 16, cards: true },
}

export function addFur (THREE, mesh, appearance, lod = 1) {
  const spec = LOD[lod] || LOD[1]
  const length = 0.008 + (appearance.furLength || 0.25) * 0.028
  const density = appearance.furDensity ?? 0.62
  const shells = []
  const nShells = Math.max(1, Math.round(spec.shells * (0.55 + density * 0.45)))

  for (let i = 1; i <= nShells; i++) {
    const t = i / nShells
    const geo = mesh.geometry.clone()
    inflate(geo, length * t)
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.0,
      transparent: true,
      opacity: (1 - t) * 0.38 * density,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const shell = new THREE.SkinnedMesh(geo, mat)
    shell.frustumCulled = false
    shell.bind(mesh.skeleton, mesh.bindMatrix)
    shell.userData.furShell = t
    shells.push(shell)
  }
  mesh.userData.furShells = shells
  mesh.userData.furLength = length
  return shells
}

export function dragFur (mesh, vx, vy, vz) {
  const shells = mesh.userData.furShells
  if (!shells) return
  const len = mesh.userData.furLength || 0.01
  for (const shell of shells) {
    const t = shell.userData.furShell
    shell.position.set(-vx * t * len * 8, -vy * t * len * 8, -vz * t * len * 8)
  }
}

function inflate (geo, amount) {
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + nor.getX(i) * amount,
      pos.getY(i) + nor.getY(i) * amount,
      pos.getZ(i) + nor.getZ(i) * amount,
    )
  }
  pos.needsUpdate = true
}
