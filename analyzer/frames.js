// Pulling usable stills out of a video, in the browser.
//
// People have far more video of their pets than good photographs, so accepting
// video matters. But evenly spaced frames are the worst possible input: a moving
// animal is motion-blurred, half the frames have it facing away, and its eyes are
// usually shut. So frames are sampled generously and then *scored*, and only the
// sharpest few are kept.
//
// Nothing is uploaded. The video is read through a blob URL inside the tab.

// There is no server here to overload, but there is still a tab that can hang or
// get killed for memory: the sampling loop below seeks through the video `sample`
// times regardless of its resolution, so a big but *short* clip — a ten-second
// walk-around shot in 4K — costs about the same as a small one. Length is what
// actually drives the cost, and length is also the tell that the wrong file got
// picked (a phone's whole camera roll export, not the one clip asked for). Nine
// times the length this is built for is generous room for someone who walked
// slowly, while still catching that.
const MAX_DURATION_SECONDS = 90

/// Sharpness by mean absolute Laplacian. A blurred frame has little
/// high-frequency energy, and this is the cheapest reliable way to say so.
function sharpness (image) {
  const { width: w, height: h, data } = image
  let sum = 0
  let count = 0
  const lum = i => 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x
      const v = 4 * lum(i) - lum(i - 1) - lum(i + 1) - lum(i - w) - lum(i + w)
      sum += Math.abs(v)
      count++
    }
  }
  return count ? sum / count : 0
}

/// Extract and keep the best `want` frames. `onProgress(done, total)` is called
/// as it goes, because this is the slowest step a visitor will sit through.
export async function framesFromVideo (file, { want = 6, sample = 18, onProgress = null } = {}) {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url

  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = () => reject(new Error('That video could not be read in this browser.'))
    })

    const duration = video.duration
    if (!isFinite(duration) || duration <= 0) throw new Error('That video has no readable length.')
    if (duration > MAX_DURATION_SECONDS) {
      throw new Error(`That's a long video — try trimming it to under ${Math.round(MAX_DURATION_SECONDS / 60)} minutes, or use photos instead.`)
    }

    const width = Math.min(640, video.videoWidth || 640)
    const height = Math.max(1, Math.round(width * ((video.videoHeight || 480) / (video.videoWidth || 640))))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    const candidates = []
    for (let i = 0; i < sample; i++) {
      // Skipping the first and last moments avoids the fade-in and the moment the
      // phone was being put down.
      const t = duration * (0.08 + (0.84 * (i + 0.5)) / sample)
      await new Promise(resolve => {
        const done = () => { video.onseeked = null; resolve() }
        video.onseeked = done
        video.currentTime = t
        // Some browsers never fire onseeked for a frame they consider identical.
        setTimeout(done, 900)
      })
      ctx.drawImage(video, 0, 0, width, height)
      const image = ctx.getImageData(0, 0, width, height)
      candidates.push({ image, score: sharpness(image), t })
      if (onProgress) onProgress(i + 1, sample)
    }

    candidates.sort((a, b) => b.score - a.score)
    // Spread the winners out in time so we do not keep six frames of one moment.
    const chosen = []
    for (const c of candidates) {
      if (chosen.length >= want) break
      if (chosen.some(k => Math.abs(k.t - c.t) < duration * 0.06)) continue
      chosen.push(c)
    }
    while (chosen.length < Math.min(want, candidates.length)) {
      const next = candidates.find(c => !chosen.includes(c))
      if (!next) break
      chosen.push(next)
    }
    return chosen.map(c => c.image)
  } finally {
    URL.revokeObjectURL(url)
    video.src = ''
  }
}

/// Decode a still image file to an ImageData, honouring EXIF rotation.
///
/// `createImageBitmap` with `imageOrientation: 'from-image'` is what does that.
/// Skipping it means a photo taken in portrait is measured sideways — the same
/// bug, in a different form, that broke the native version's body-part sampling.
export async function frameFromImage (file, maxWidth = 900) {
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    bitmap = await createImageBitmap(file)
  }
  const scale = Math.min(1, maxWidth / bitmap.width)
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  return ctx.getImageData(0, 0, w, h)
}
