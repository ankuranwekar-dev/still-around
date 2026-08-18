import { createPet } from '../pet.js'
import { setupScene, addContactShadow, frameCamera } from '../scene.js'
import { defaultCat, defaultDog, fromHex, CoatPattern } from '../../engine/appearance.js'

export const name = 'face'

const cat = {
  ...defaultCat(),
  pattern: CoatPattern.tabby,
  base: fromHex(0xc98a4b), accent: fromHex(0x8a5a2a),
  eye: fromHex(0x9dae72), capCoverage: 0.5, faceBlaze: 0.45, chestWhite: 0.85,
}
const dog = {
  ...defaultDog(),
  pattern: CoatPattern.bicolour,
  base: fromHex(0x9a6a3a), accent: fromHex(0x33291f),
  faceBlaze: 0.55, chestWhite: 0.75,
  morphs: { muzzleLength: 0.3 },
}

export const views = ['front', 'three-quarter', 'profile'].flatMap(kind => ([
  { id: `cat-${kind}`, label: `cat ${kind}`, appearance: cat, kind },
  { id: `dog-${kind}`, label: `dog ${kind}`, appearance: dog, kind },
]))

export function create (THREE) {
  const { scene, camera } = setupScene(THREE)
  addContactShadow(THREE, scene, 0.12)
  let current = null

  function show (view) {
    if (current) {
      scene.remove(current.root)
      current.dispose()
    }
    current = createPet(THREE, view.appearance, { lod: 1 })
    current.play('sit')
    scene.add(current.root)
    const y = view.appearance.species === 'dog' ? 0.28 : 0.22
    if (view.kind === 'front') camera.position.set(0, y, 0.42)
    else if (view.kind === 'profile') camera.position.set(0.42, y, 0.04)
    else camera.position.set(0.28, y + 0.04, 0.34)
    camera.lookAt(0, y, 0.12)
  }

  show(views[0])
  return {
    scene, camera,
    setView (view) { show(view) },
    tick () {},
    dispose () { current?.dispose() },
  }
}
