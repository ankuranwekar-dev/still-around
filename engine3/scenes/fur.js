import { createPet } from '../pet.js'
import { setupScene, addContactShadow, frameCamera } from '../scene.js'
import { defaultCat, fromHex, CoatPattern } from '../../engine/appearance.js'

export const name = 'fur'

const longHair = {
  ...defaultCat(),
  pattern: CoatPattern.tabby,
  base: fromHex(0xd08c46), accent: fromHex(0x9a5f28),
  furLength: 0.85, furDensity: 0.9, chestWhite: 0.4,
}

export const views = [
  { id: 'lod0', label: 'LOD 0 · 4 shells', lod: 0, yaw: 0.6 },
  { id: 'lod1', label: 'LOD 1 · 8 shells', lod: 1, yaw: 0.6 },
  { id: 'lod2', label: 'LOD 2 · 12 shells', lod: 2, yaw: 0.6 },
  { id: 'backlit', label: 'backlit ear', lod: 1, yaw: 2.4 },
  { id: 'sil64', label: '64px silhouette', lod: 1, yaw: 0.8, silhouette: true },
]

export function create (THREE) {
  const { scene, camera } = setupScene(THREE)
  addContactShadow(THREE, scene, 0.16)
  let current = null

  function show (view) {
    if (current) {
      scene.remove(current.root)
      current.dispose()
    }
    current = createPet(THREE, longHair, { lod: view.lod ?? 1 })
    current.play('sit')
    scene.add(current.root)
    frameCamera(camera, 'cat', 'three-quarter')
    camera.position.set(Math.sin(view.yaw) * 0.7, 0.22, Math.cos(view.yaw) * 0.7)
    camera.lookAt(0, 0.14, 0)
    if (view.silhouette) scene.background = new THREE.Color(0x111111)
  }

  show(views[0])
  return {
    scene, camera,
    setView (view) { show(view) },
    tick () {},
    dispose () { current?.dispose() },
  }
}
