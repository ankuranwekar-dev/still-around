// Shared Playwright + static-server boot for the 3D harnesses.
//
// Chromium in headless mode paints a black canvas unless it has either a real
// GPU (`headless: "new"` plus ANGLE) or SwiftShader. We try the GPU first and
// fall back to `--use-angle=swiftshader` if the sheet comes back black.

import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

const root = new URL('..', import.meta.url).pathname

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
}

const ARGS = {
  gpu: [
    '--ignore-gpu-blocklist',
    '--enable-gpu',
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-webgl',
    '--enable-unsafe-webgpu',
  ],
  swiftshader: [
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
  ],
}

function serveRepo () {
  return new Promise(resolve => {
    const server = createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1')
      let path = normalize(join(root, decodeURIComponent(url.pathname)))
      if (!path.startsWith(root)) {
        response.writeHead(403).end('no')
        return
      }
      try {
        if (statSync(path).isDirectory()) path = join(path, 'index.html')
      } catch {
        response.writeHead(404).end('not found')
        return
      }
      try {
        const size = statSync(path).size
        response.writeHead(200, {
          'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
          'Content-Length': size,
          'Cache-Control': 'no-store, must-revalidate',
        })
        createReadStream(path).pipe(response)
      } catch {
        response.writeHead(404).end('not found')
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise(r => server.close(r)),
      })
    })
  })
}

function parseFlag (argv, name, fallback) {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const next = argv[i + 1]
  if (!next || next.startsWith('--')) return true
  return next
}

export function flags (argv = process.argv.slice(2)) {
  const positional = argv.filter(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true)
  // The filter above is messy when flags take values. Parse explicitly.
  const out = { positional: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      out.positional.push(a)
      continue
    }
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out[key] = next
      i++
    } else {
      out[key] = true
    }
  }
  return out
}

export { parseFlag }

export async function withHarness (opts, run) {
  const scene = opts.scene || 'sphere'
  const gl = opts.gl || 'auto'
  const server = await serveRepo()
  const modes = gl === 'webgl' || gl === 'swiftshader'
    ? ['swiftshader']
    : gl === 'gpu' || gl === 'webgpu'
      ? ['gpu']
      : ['gpu', 'swiftshader']

  let lastError = null
  try {
    for (const mode of modes) {
      const browser = await chromium.launch({
        headless: true,
        args: ARGS[mode],
      })
      try {
        const page = await browser.newPage()
        page.on('pageerror', err => console.error('[harness]', err.message))
        const glQuery = mode === 'swiftshader' ? 'webgl' : (gl === 'webgpu' ? 'auto' : 'auto')
        const url = `${server.url}/engine3/harness.html?scene=${encodeURIComponent(scene)}&gl=${glQuery}`
        await page.goto(url, { waitUntil: 'load', timeout: 60_000 })
        await page.waitForFunction(() => window.__engine3 && window.__engine3.ready, null, { timeout: 60_000 })
        const bootError = await page.evaluate(() => window.__engine3.error || null)
        if (bootError) throw new Error(bootError)
        const result = await run(page)
        if (result && result.black && mode !== modes[modes.length - 1]) {
          lastError = new Error(`black frame on ${mode} (mean luma ${result.meanLuma?.toFixed?.(2)})`)
          await browser.close()
          continue
        }
        return { ...result, chromium: mode }
      } catch (err) {
        lastError = err
        if (mode === modes[modes.length - 1]) throw err
      } finally {
        await browser.close().catch(() => {})
      }
    }
    throw lastError || new Error('harness failed')
  } finally {
    await server.close()
  }
}

export function dataUrlToBuffer (dataUrl) {
  const comma = dataUrl.indexOf(',')
  return Buffer.from(dataUrl.slice(comma + 1), 'base64')
}
