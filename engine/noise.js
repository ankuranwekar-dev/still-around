// Deterministic value noise.
//
// Coats use it to scatter a tortoiseshell's patches and to wobble marking edges
// so they follow fur rather than tracing a clean mathematical curve. It has to
// be a pure function of position: anything seeded from a random number generator
// would differ frame to frame and the markings would shimmer as the pet moved.

function hash2 (x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return h - Math.floor(h)
}

function smooth (t) {
  return t * t * (3 - 2 * t)
}

export function value (x, y) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = smooth(x - xi), yf = smooth(y - yi)
  const a = hash2(xi, yi), b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1)
  const top = a + (b - a) * xf
  const bottom = c + (d - c) * xf
  return top + (bottom - top) * yf
}

/// Two octaves — enough to break up an edge without turning it to mush.
export function fbm (x, y) {
  return value(x, y) * 0.65 + value(x * 2.3 + 5.2, y * 2.3 + 1.7) * 0.35
}
