// Where pets live between sessions.
//
// One JSON file in the user's application-support directory. No database, no
// cloud, nothing to sign into — a pet is thirty numbers, and the file it came
// from was small enough to email.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { migratePet } from '../../../engine3/appearance.js'

const file = () => path.join(app.getPath('userData'), 'pets.json')

const DEFAULTS = {
  visible: true,
  pets: [],
  settings: {
    // Frame rate drops hard when nothing is happening; a desktop toy that costs
    // battery gets uninstalled.
    activeFps: 30,
    idleFps: 8,
    scale: 0.175,  // pet height as a fraction of screen height; see tray.js's Size menu
    speech: true,
  },
}

export async function loadState () {
  try {
    const raw = await fs.readFile(file(), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULTS,
      ...parsed,
      settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
      pets: Array.isArray(parsed.pets) ? parsed.pets : [],
    }
  } catch {
    return structuredClone(DEFAULTS)
  }
}

export async function saveState (state) {
  await fs.mkdir(path.dirname(file()), { recursive: true })
  await fs.writeFile(file(), JSON.stringify(state, null, 2), 'utf8')
}

/// Validates rather than trusts. A pet file is user-supplied JSON, and a missing
/// field would otherwise surface as a blank window with no explanation.
function validate (pet) {
  if (!pet || typeof pet !== 'object') throw new Error('The file is not a pet.')
  const migrated = migratePet(pet)
  const appearance = migrated.appearance
  for (const key of ['base', 'accent', 'eye', 'nose']) {
    const c = appearance[key]
    if (!c || typeof c.r !== 'number') throw new Error(`Its ${key} colour is missing.`)
  }
  if (appearance.species !== 'cat' && appearance.species !== 'dog') {
    appearance.species = 'cat'
  }
  return {
    id: `pet-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: migrated.name,
    enabled: true,
    appearance,
  }
}

export async function importPetFile (state, filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  const pet = validate(JSON.parse(raw))
  state.pets = [...state.pets, pet]
  await saveState(state)
  return state
}

export async function removePet (state, id) {
  state.pets = state.pets.filter(p => p.id !== id)
  await saveState(state)
  return state
}
