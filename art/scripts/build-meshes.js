// The meshes are code. This writes a provenance stamp into art/build so the
// static host still has no Blender step. Real .glb from licensed blends will
// replace these stamps via art/scripts/export.py.

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { felisProfile, canisProfile } from '../../engine3/species/profiles.js'

const buildDir = fileURLToPath(new URL('../build', import.meta.url))
mkdirSync(buildDir, { recursive: true })
const note = species => ({
  format: 'still-around/procedural-mesh',
  species,
  source: 'engine3/mesh.js',
  licence: 'MIT',
  note: 'Original geometry, not a marketplace asset. Replace with a licensed glb via art/scripts/export.py when §2 is resolved.',
  bind: species === 'dog' ? canisProfile() : felisProfile(),
})
writeFileSync(new URL('../build/felis.json', import.meta.url), JSON.stringify(note('cat'), null, 2))
writeFileSync(new URL('../build/canis.json', import.meta.url), JSON.stringify(note('dog'), null, 2))
console.log('wrote art/build/felis.json and art/build/canis.json')
