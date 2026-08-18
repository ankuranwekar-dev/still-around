// Scene registry. The harness loads by name so later phases can add `fur` or
// `walk` without teaching the Playwright driver about them.

const loaders = {
  sphere: () => import('./scenes/sphere.js'),
}

export function listScenes () {
  return Object.keys(loaders)
}

export async function loadScene (name) {
  const load = loaders[name]
  if (!load) throw new Error(`unknown scene "${name}". known: ${listScenes().join(', ')}`)
  return load()
}
