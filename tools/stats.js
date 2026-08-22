// How many people came, and how many took the app away with them.
//
// The two halves live in different places and neither can see the other: visits
// are counted by the site's own host, and downloads happen on GitHub, which is a
// different origin the site never hears back from. GitHub keeps a count per
// release asset, and that count is the only download figure that exists — the
// button click on the site is a click, not a download.
//
//   node tools/stats.js
//
// Nothing here needs a token: a public repository's release counts are public.

const REPO = 'ankuranwekar-dev/still-around'

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

const releases = await fetch(`https://api.github.com/repos/${REPO}/releases`)
  .then(r => r.json())
  .catch(() => null)

if (!Array.isArray(releases)) {
  console.error('Could not reach GitHub. Rate limited, or offline.')
  process.exit(1)
}

const published = releases.filter(r => !r.draft)
if (!published.length) {
  console.log('No published releases yet, so nothing has been downloaded.')
  const drafts = releases.filter(r => r.draft)
  if (drafts.length) console.log(`(${plural(drafts.length, 'draft')} waiting to be published.)`)
  process.exit(0)
}

let macTotal = 0
let winTotal = 0

console.log('Downloads, by release\n')
for (const release of published) {
  const assets = release.assets || []
  if (!assets.length) continue
  const total = assets.reduce((sum, a) => sum + a.download_count, 0)
  console.log(`  ${release.tag_name}  ${release.published_at?.slice(0, 10) ?? ''}  — ${plural(total, 'download')}`)
  for (const a of assets) {
    console.log(`      ${a.name.padEnd(30)} ${a.download_count}`)
    if (/mac|dmg/i.test(a.name)) macTotal += a.download_count
    if (/win|exe/i.test(a.name)) winTotal += a.download_count
  }
}

console.log(`\n  macOS ${macTotal}   Windows ${winTotal}   total ${macTotal + winTotal}`)
console.log('\nVisits, referrers and countries are in the Vercel dashboard:')
console.log('  https://vercel.com/ankur-anwekars-projects/still-around/analytics')
