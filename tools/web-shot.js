// Screenshots of the website, for looking at.
//
// The rest of tools/ renders the animals; this renders the pages around them.
// The vision models are blocked so a shot is not waiting on 20 MB of weights it
// is not going to show anyway.
//
//   node tools/serve.js 8731 &
//   node tools/web-shot.js out.png                       # full page, 1280 wide
//   node tools/web-shot.js out.png /web/personas.html 393 # one page, phone width

import { chromium } from 'playwright'

const out = process.argv[2] || 'page.png'
const path = process.argv[3] || '/web/'
const width = Number(process.argv[4] || 1280)
const port = Number(process.env.PORT || 8731)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
for (const pattern of ['**huggingface.co/**', '**cdn.jsdelivr.net/**']) {
  await page.route(pattern, route => route.abort())
}
page.on('pageerror', err => console.log('[pageerror]', String(err).slice(0, 300)))
page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)) })

await page.goto(`http://localhost:${port}${path}`, { waitUntil: 'domcontentloaded' })
// Long enough for the first animation clips to be drawn and swapped in.
await page.waitForTimeout(4000)
await page.screenshot({ path: out, fullPage: true })
console.log('wrote', out)
await browser.close()
