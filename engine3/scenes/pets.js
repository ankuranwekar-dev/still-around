import { createPet } from '../pet.js'
import { setupScene, addContactShadow, frameCamera } from '../scene.js'
import { defaultCat, defaultDog, fromHex, CoatPattern, EarStyle, TailStyle } from '../../engine/appearance.js'

export const name = 'pets'

const animals = [
  ['ginger', {
    ...defaultCat(),
    pattern: CoatPattern.tabby,
    base: fromHex(0xc98a4b), accent: fromHex(0x8a5a2a),
    eye: fromHex(0x9dae72), capCoverage: 0.5, faceBlaze: 0.45,
    chestWhite: 0.85, socks: 0.9, tailBands: 0.5, patternContrast: 0.6,
  }],
  ['calico', {
    ...defaultCat(),
    pattern: CoatPattern.calico,
    base: fromHex(0xa08a72), accent: fromHex(0xc07a3a),
    capCoverage: 0.62, faceBlaze: 0.5, chestWhite: 0.7, socks: 0.6, patchiness: 0.65,
  }],
  ['black', {
    ...defaultCat(),
    pattern: CoatPattern.solid,
    base: fromHex(0x2e2a28), accent: fromHex(0x1d1a18),
    eye: fromHex(0xc8a63c), capCoverage: 1, chestWhite: 0, socks: 0, saddle: 1,
  }],
  ['tuxedo', {
    ...defaultCat(),
    pattern: CoatPattern.tuxedo,
    base: fromHex(0x232120), accent: fromHex(0x141312),
    capCoverage: 0.72, faceBlaze: 0.6, chestWhite: 0.95, socks: 1,
  }],
  ['beagle', {
    ...defaultDog(),
    pattern: CoatPattern.bicolour,
    base: fromHex(0x9a6a3a), accent: fromHex(0x33291f),
    snout: 0.6, capCoverage: 0.8, faceBlaze: 0.55, chestWhite: 0.75, socks: 0.9, saddle: 0.6,
    morphs: { legLength: -0.55, backLength: 0.65, muzzleLength: 0.15, hockAngle: 0.2 },
  }],
  ['retriever', {
    ...defaultDog(),
    base: fromHex(0xd7a55e), accent: fromHex(0xb07f3c),
    furLength: 0.6, tailStyle: TailStyle.fluffy, size: 1.25,
    chestWhite: 0.22,
    morphs: { legLength: 0.45, chestDepth: 0.4, tailFluff: 0.8, bodyMass: 0.3, earSize: 0.2 },
  }],
]

export const views = animals.flatMap(([label, appearance]) => ([
  { id: `${label}-sit`, label: `${label} sit`, appearance, clip: 'sit', kind: 'front' },
  { id: `${label}-side`, label: `${label} side`, appearance, clip: 'walk', kind: 'side' },
]))

export function create (THREE) {
  const { scene, camera } = setupScene(THREE)
  addContactShadow(THREE, scene, 0.2)
  let current = null

  function show (view) {
    if (current) {
      scene.remove(current.root)
      current.dispose()
    }
    current = createPet(THREE, view.appearance, { lod: 1 })
    current.play(view.clip || 'sit')
    if (view.kind === 'side') current.root.rotation.y = 0
    current.tick(view.clip === 'walk' ? 0.25 : 0)
    scene.add(current.root)
    frameCamera(camera, view.appearance.species, view.kind === 'side' ? 'side' : 'front')
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
