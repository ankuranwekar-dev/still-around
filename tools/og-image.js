// Renders web/og.png — the picture that shows up when the site is pasted into a
// message. Without one, every share of stillaround.online is a grey box, which is
// a poor showing for a site whose whole point is that it draws your pet.
//
// It photographs the real hero rather than shipping a hand-made banner, so the
// card can never drift out of date with the page, and the cats in it are drawn by
// the same engine a visitor is about to run.
//
//   node tools/serve.js 8731 &
//   node tools/og-image.js

import { chromium } from 'playwright'

const port = Number(process.env.PORT || 8731)
const out = process.argv[2] || new URL('../web/og.png', import.meta.url).pathname

// 1200x630 is the size every link unfurler crops to; deviceScaleFactor 2 keeps it
// sharp on the retina screens most of these previews are read on.
const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
})
for (const pattern of ['**huggingface.co/**', '**cdn.jsdelivr.net/**']) {
  await page.route(pattern, route => route.abort())
}
page.on('pageerror', err => console.log('[pageerror]', String(err).slice(0, 300)))

await page.goto(`http://localhost:${port}/web/`, { waitUntil: 'domcontentloaded' })
// The cats are the subject of the card, so wait for the first clips to be drawn
// and swapped in before the shutter, exactly as web-shot.js does.
await page.waitForTimeout(4000)

// The sticky header is chrome, not content — it eats 60px of a card that only has
// 630 to spend. Everything below the hero goes too: at this crop the next section
// contributes nothing but a row of sliced-off card tops along the bottom edge.
await page.evaluate(() => {
  const header = document.querySelector('header.top')
  if (header) header.style.display = 'none'
  const hero = document.querySelector('.hero')
  for (let el = hero?.nextElementSibling; el; el = el.nextElementSibling) {
    el.style.display = 'none'
  }
})

await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } })
await browser.close()
console.log('wrote', out)
