// A static server for development that refuses to be cached.
//
// `python -m http.server` answers with Last-Modified and no Cache-Control, and a
// browser will happily keep serving an ES module from memory across reloads — so
// edits to engine/*.js silently did nothing while the page looked reloaded. An
// afternoon went into chasing a "bug" that was a stale module. Never again.
//
//   node tools/serve.js [port]

import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const port = Number(process.argv[2] || 8731)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
}

createServer((request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`)
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
      // The vision models need these to use SharedArrayBuffer for threaded WASM.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    })
    createReadStream(path).pipe(response)
  } catch {
    response.writeHead(404).end('not found')
  }
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`))
