// WebGPU first, WebGL2 fallback. The fallback is a flag (`forceWebGL`), not a
// second engine. Headless Chromium with SwiftShader has no WebGPU, so the
// harness takes that path every time it has to; a real window tries WebGPU and
// falls back inside three's own renderer.

export async function createRenderer (THREE, canvas, {
  width, height, dpr = 2, alpha = false, forceWebGL = false,
} = {}) {
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    alpha,
    forceWebGL,
    // Overlay compositing (Phase 9): CoreGraphics wants premultiplied. Canvas 2D
    // wants straight. Getting this backwards is a dark halo. Default premultiplied
    // here; the 2D contact-sheet compositor draws immediately after render().
    premultipliedAlpha: true,
  })
  await renderer.init()
  renderer.setPixelRatio(Math.min(dpr, 2))
  renderer.setSize(width, height, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  // AgX is the working tonemap from day one so we do not composite in flat sRGB
  // and then have to undo it. Phase 2 will wire a proper working space and a
  // shoulder that replaces coat.js's SHADOW_FLOOR.
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.toneMappingExposure = 1

  const backend = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2'
  return { renderer, backend }
}

export function describeGpu (renderer) {
  try {
    const gl = renderer.backend?.gl
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      if (ext) return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      return gl.getParameter(gl.RENDERER)
    }
    const adapter = renderer.backend?.adapter
    if (adapter?.info) {
      const { vendor, device, architecture } = adapter.info
      return [vendor, device, architecture].filter(Boolean).join(' ')
    }
  } catch {
    // debug_renderer_info is optional; a blank label is fine.
  }
  return renderer.backend?.constructor?.name ?? 'unknown'
}

export function isSoftwareGpu (label) {
  return /swiftshader|llvmpipe|softpipe|microsoft basic render|apple software/i.test(label)
}
