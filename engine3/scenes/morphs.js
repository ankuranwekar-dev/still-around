import { createPet } from '../pet.js'
import { setupScene, addContactShadow, frameCamera } from '../scene.js'
import { defaultCat, defaultDog, fromHex, CoatPattern, TailStyle } from '../../engine/appearance.js'

export const name = 'morphs'

const extremes = [
  ['skullWidth +', { skullWidth: 1 }],
  ['muzzleLen +', { muzzleLength: 1 }],
  ['chestDepth +', { chestDepth: 1 }],
  ['waistTuck +', { waistTuck: 1 }],
  ['legLength +', { legLength: 1 }],
  ['legLength −', { legLength: -1 }],
  ['backLength +', { backLength: 1 }],
  ['tailLength +', { tailLength: 1 }],
]

const beagle = {
  ...defaultDog(),
  pattern: CoatPattern.bicolour,
  base: fromHex(0x9a6a3a), accent: fromHex(0x33291f),
  capCoverage: 0.8, faceBlaze: 0.55, chestWhite: 0.75, socks: 0.9, saddle: 0.6,
  morphs: { legLength: -0.65, backLength: 0.7, chestDepth: 0.15, muzzleLength: 0.2, bodyMass: -0.15, hockAngle: 0.2, toplineSlope: 0.2 },
}
const lab = {
  ...defaultDog(),
  base: fromHex(0x26241f), accent: fromHex(0x171612),
  size: 1.3, capCoverage: 1, chestWhite: 0,
  morphs: { legLength: 0.75, chestDepth: 0.55, backLength: -0.1, bodyMass: 0.45, muzzleLength: 0.35, toplineSlope: 0.4, hockAngle: 0.15 },
}

export const views = [
  ...extremes.map(([label], i) => ({ id: `cat-${i}`, label: `cat ${label}`, species: 'cat', morphs: extremes[i][1], yaw: 0.7 })),
  ...extremes.map(([label], i) => ({ id: `dog-${i}`, label: `dog ${label}`, species: 'dog', morphs: extremes[i][1], yaw: 0.7 })),
  { id: 'beagle', label: 'beagle', appearance: beagle, yaw: 0.7 },
  { id: 'lab', label: 'labrador', appearance: lab, yaw: 0.7 },
]

export function create (THREE) {
  const { scene, camera } = setupScene(THREE)
  addContactShadow(THREE, scene, 0.18)
  let current = null

  function show (view) {
    if (current) {
      scene.remove(current.root)
      current.dispose()
    }
    const appearance = view.appearance || {
      ...(view.species === 'dog' ? defaultDog() : defaultCat()),
      morphs: view.morphs,
    }
    current = createPet(THREE, appearance, { lod: 0 })
    current.play('sit')
    scene.add(current.root)
    frameCamera(camera, appearance.species, 'three-quarter')
  }

  show(views[0])

  return {
    scene,
    camera,
    setView (view) { show(view) },
    tick () {},
    dispose () { current?.dispose() },
  }
}
