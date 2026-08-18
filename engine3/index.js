// Public entry for the 3D engine. Web and desktop import this unmodified.

export { createRenderer, describeGpu, isSoftwareGpu } from './renderer.js'
export { createPet } from './pet.js'
export { createStage3 } from './stage.js'
export { migratePet, toPetFile } from './appearance.js'
export { setupScene, addContactShadow, frameCamera } from './scene.js'
export { buildSpecies } from './mesh.js'
export { LOD } from './fur.js'
