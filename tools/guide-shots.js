// Photographs the real studio for the guide page.
//
// The guide could have had drawn illustrations, but then there would be two
// pictures of the product — the one on the guide and the one people actually
// meet — and only one of them updates when the studio changes. These are taken
// from the running page, so re-running this after a UI change is the whole
// maintenance story.
//
//   node tools/serve.js 8731 &
//   node tools/guide-shots.js

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const port = Number(process.env.PORT || 8731)
const out = new URL('../web/guide/', import.meta.url).pathname
await mkdir(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1000, height: 900 },
  deviceScaleFactor: 2,
})
// The models are 20 MB and none of these shots are waiting on them.
for (const pattern of ['**huggingface.co/**', '**cdn.jsdelivr.net/**']) {
  await page.route(pattern, route => route.abort())
}
page.on('pageerror', err => console.log('[pageerror]', String(err).slice(0, 200)))

await page.goto(`http://localhost:${port}/web/`, { waitUntil: 'domcontentloaded' })
// The slot art is drawn by the engine; give it time to appear or the first shot
// is four empty tiles.
await page.waitForTimeout(4500)

/// Photograph one element. A locator screenshot rather than a clipped page one:
/// the studio sits well below the fold, and a clip is measured against the
/// viewport, so every one of these was landing outside the image.
async function shot (selector, file) {
  const target = page.locator(selector).first()
  if (!(await target.count())) { console.log(`skipped ${file}: ${selector} not found`); return }
  await target.scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  await target.screenshot({ path: `${out}${file}` })
  console.log('wrote', file)
}

// 1. The four shot slots — the part everyone has to understand.
await shot('#slots', 'photos.png')

// 2. The likeness editor. "Start from a blank pet" reaches it without needing a
//    real animal, which is the only way this can run unattended.
await page.locator('#skip').click()
await page.waitForTimeout(3500)
await shot('#stage-result .card, #stage-result', 'likeness.png')

await browser.close()
