import { createPet } from '../pet.js'
import { setupScene, addContactShadow, frameCamera } from '../scene.js'
import { defaultCat, defaultDog, fromHex, CoatPattern } from '../../engine/appearance.js'

export const name = 'walk'

const cat = {
  ...defaultCat(),
  pattern: CoatPattern.tabby,
  base: fromHex(0xc98a4b), accent: fromHex(0x8a5a2a),
  faceBlaze: 0.45, chestWhite: 0.5, patternContrast: 0.55,
}
const dog = {
  ...defaultDog(),
  pattern: CoatPattern.bicolour,
  base: fromHex(0x9a6a3a), accent: fromHex(0x33291f),
  chestWhite: 0.5,
  morphs: { legLength: 0.3, chestDepth: 0.3, toplineSlope: 0.35, hockAngle: 0.2 },
}

export const views = [
  { id: 'cat-walk', label: 'cat walk', appearance: cat, clip: 'walk', t: 0.2 },
  { id: 'cat-trot', label: 'cat trot', appearance: cat, clip: 'trot', t: 0.2 },
  { id: 'cat-walk-b', label: 'cat walk 2', appearance: cat, clip: 'walk', t: 0.55 },
  { id: 'dog-walk', label: 'dog walk', appearance: dog, clip: 'walk', t: 0.2 },
  { id: 'dog-trot', label: 'dog trot', appearance: dog, clip: 'trot', t: 0.2 },
  { id: 'dog-walk-b', label: 'dog walk 2', appearance: dog, clip: 'walk', t: 0.55 },
  { id: 'cat-tail', label: 'cat tail', appearance: cat, clip: 'walk', t: 0.3, kind: 'side' },
  { id: 'dog-tail', label: 'dog tail', appearance: dog, clip: 'walk', t: 0.3, kind: 'side' },
]

export function create (THREE) {
  const { scene, camera } = setupScene(THREE)
  addContactShadow(THREE, scene, 0.22)
  let current = null

  function show (view) {
    if (current) {
      scene.remove(current.root)
      current.dispose()
    }
    current = createPet(THREE, view.appearance, { lod: 1 })
    current.play(view.clip, 1)
    current.root.rotation.y = 0
    current.tick(view.t || 0)
    scene.add(current.root)
    frameCamera(camera, view.appearance.species, 'side')
  }

  show(views[0])
  return {
    scene, camera,
    setView (view) { show(view) },
    tick () {},
    dispose () { current?.dispose() },
  }
}
