// Minimal PNG encoder — enough to write RGBA out for eyeballing, with no
// dependency to install. Uses zlib, which Node already has.

import { deflateSync, inflateSync } from 'node:zlib'

function crc32 (buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk (type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/// `rgba` is width*height*4 straight (non-premultiplied) bytes.
export function encodePNG (rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer ?? rgba, 0, rgba.length)
      .copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/// Compose several RGBA tiles onto one dark canvas, for contact sheets.
export function sheet (tiles, { cols, cell, pad = 8, bg = [0x1e, 0x22, 0x28] }) {
  const rows = Math.ceil(tiles.length / cols)
  const width = cols * (cell + pad) + pad
  const height = rows * (cell + pad) + pad
  const canvas = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    canvas[i * 4] = bg[0]; canvas[i * 4 + 1] = bg[1]; canvas[i * 4 + 2] = bg[2]; canvas[i * 4 + 3] = 255
  }
  tiles.forEach((tile, idx) => {
    const ox = pad + (idx % cols) * (cell + pad)
    const oy = pad + Math.floor(idx / cols) * (cell + pad)
    const scale = tile.size / cell
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const sx = Math.min(tile.size - 1, Math.floor(x * scale))
        const sy = Math.min(tile.size - 1, Math.floor(y * scale))
        const s = (sy * tile.size + sx) * 4
        const a = tile.rgba[s + 3] / 255
        if (a === 0) continue
        const d = ((oy + y) * width + ox + x) * 4
        for (let c = 0; c < 3; c++) {
          canvas[d + c] = tile.rgba[s + c] * a + canvas[d + c] * (1 - a)
        }
      }
    }
  })
  return { rgba: canvas, width, height }
}

/// Read a PNG into { width, height, data } with RGBA bytes. Enough of the format
/// to load the test corpus, and no dependency to install.
export function decodePNG (buffer) {
  let pos = 8
  let width = 0, height = 0, bitDepth = 8, colourType = 6
  const idat = []
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      bitDepth = data[8]; colourType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType]
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8ClampedArray(width * height * 4)
  const prior = new Uint8Array(stride)
  const line = new Uint8Array(stride)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prior[i]
      const c = i >= channels ? prior[i - channels] : 0
      let v = src[i]
      switch (filter) {
        case 1: v += a; break
        case 2: v += b; break
        case 3: v += (a + b) >> 1; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          break
        }
      }
      line[i] = v & 0xff
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels
      const d = (y * width + x) * 4
      if (channels >= 3) {
        out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]
        out[d + 3] = channels === 4 ? line[s + 3] : 255
      } else {
        out[d] = out[d + 1] = out[d + 2] = line[s]
        out[d + 3] = channels === 2 ? line[s + 1] : 255
      }
    }
    prior.set(line)
  }
  return { width, height, data: out }
}
