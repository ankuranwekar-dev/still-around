// Assembles the public site into dist/ — the only directory that ever gets deployed.
//
// Two things make this a real script rather than a copy command.
//
// First, safety. The repository root holds a Developer ID *private key*, unsigned
// plans and build tooling, none of which are gitignored. Deploying the root with a
// couple of rewrites would publish all of it. So this is an allowlist: nothing
// reaches dist/ unless it is named below.
//
// Second, the layout. web/ is flattened into the root of dist/ so the site lives at
// / instead of /web/. That sounds like it would break `from '../engine/x.js'` in
// main.js — but a browser clamps a leading `..` at the origin root, so
// /main.js + ../engine/x.js resolves to /engine/x.js, exactly where this puts it.
// Development (repo root served, page at /web/) and production (page at /) then
// agree on every module URL, and not one import statement has to change.
//
//   node tools/build-site.js

import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const dist = join(root, 'dist')

// Copied whole, keeping their directory name. These are the ES modules the page
// imports; everything they need is code, so there are no assets to chase.
const TREES = ['engine', 'engine3', 'analyzer']

// Copied file by file into the root of dist/. Anything else in web/ is not served.
const PAGE = [
  'index.html',
  'personas.html',
  'style.css',
  'main.js',
  'personas.js',
  'config.js',
  'pet-worker.js',
  'og.png', // the link-preview card, referenced absolutely from index.html
  'guide.html',
]

// Copied whole. guide/ holds the screenshots of the real studio that the guide
// page is built around; tools/guide-shots.js regenerates them.
const PAGE_DIRS = ['guide']

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

for (const file of PAGE) {
  await cp(join(root, 'web', file), join(dist, file))
}

for (const tree of TREES) {
  await cp(join(root, tree), join(dist, tree), { recursive: true })
}

for (const dir of PAGE_DIRS) {
  await cp(join(root, 'web', dir), join(dist, dir), { recursive: true })
}

// A missed import is a blank page in production and a 404 nobody reads, so fail the
// build here instead: every ../ import in the copied JS must land on a real file.
const problems = []
for (const file of await walk(dist)) {
  if (!file.endsWith('.js')) continue
  const source = await readFile(file, 'utf8')
  const here = file.slice(dist.length)
  for (const spec of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
    // Resolved against a fake origin, so a leading ../ clamps at the site root
    // exactly as it will in the browser rather than escaping into the repo.
    const target = new URL(spec[1], `https://site${here}`).pathname
    if (!(await exists(join(dist, target)))) problems.push(`${here} → ${spec[1]}`)
  }
}

if (problems.length) {
  console.error('Unresolved imports in dist/:\n  ' + problems.join('\n  '))
  process.exit(1)
}

console.log(`dist/ built — ${(await walk(dist)).length} files, site root is dist/index.html`)

async function walk (dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    out.push(...(entry.isDirectory() ? await walk(path) : [path]))
  }
  return out
}

async function exists (path) {
  try { await stat(path); return true } catch { return false }
}
