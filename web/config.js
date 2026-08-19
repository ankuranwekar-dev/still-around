// Everything you need to fill in before the site goes live, in one place.
//
// Until `downloads.mac` and `downloads.windows` point at real files, the two
// download buttons say "Coming soon" — which is honest, but it also means the
// thing the site is for cannot be had. Publishing them is the one remaining
// blocker: push a `v*` tag so .github/workflows/release.yml builds the DMG and
// the EXE, then paste the two release URLs in below.
//
// None of these are secrets — the whole site is static and there is no server, so
// there is nowhere for a secret to live and nothing that could leak. Anything a
// visitor uploads is read inside their own browser tab and never sent anywhere.

export const SITE = {
  /// Where the desktop builds live. Point these at a GitHub release once
  /// .github/workflows/release.yml has run; until then the buttons explain that
  /// the build is not out yet rather than 404ing.
  downloads: {
    mac: '', // e.g. 'https://github.com/you/still-around/releases/latest/download/StillAround-mac.dmg'
    windows: '', // e.g. '.../StillAround-win.exe'
    source: 'https://github.com/', // repository page
  },

  /// A tip jar, not a checkout. Ko-fi, Buy Me a Coffee and GitHub Sponsors all
  /// work; leave blank to hide the donate section entirely.
  donateUrl: '',
  donateLabel: 'Buy me a coffee',

  /// Cookieless analytics. Plausible is the default because it sets no cookies,
  /// stores no personal data, and needs no consent banner — which matters when
  /// the whole promise of the site is that it does not look at your things.
  /// Set `domain` to your site and the script tag is added automatically.
  analytics: {
    provider: 'plausible',
    domain: '', // e.g. 'stillaround.app'
    src: 'https://plausible.io/js/script.js',
  },
}
