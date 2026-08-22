// Everything you need to fill in before the site goes live, in one place.
//
// None of these are secrets — the whole site is static and there is no server, so
// there is nowhere for a secret to live and nothing that could leak. Anything a
// visitor uploads is read inside their own browser tab and never sent anywhere.

export const SITE = {
  /// The site itself, once it has a domain. The desktop app's tray menu opens
  /// this for "Make one" — someone testing the app without ever having visited
  /// the site — falling back to the repository below if it is still blank.
  siteUrl: 'https://stillaround.online',

  /// Where the desktop builds live.
  ///
  /// These point at the v1.0.0 tag specifically, because artifactName in
  /// package.json bakes the version into the filename
  /// (StillAround-mac-1.0.0.dmg) — the /releases/latest/download/ alias
  /// would silently 404 the moment a new version tag changes that filename.
  /// Update both URLs by hand on every release until artifactName drops
  /// ${version}, at which point /latest/download/ becomes safe to use and
  /// this stops being a manual step.
  downloads: {
    mac: 'https://github.com/ankuranwekar-dev/still-around/releases/download/v1.2.4/StillAround-mac-1.2.4.dmg',
    windows: 'https://github.com/ankuranwekar-dev/still-around/releases/download/v1.2.4/StillAround-win-1.2.4.exe',
    source: 'https://github.com/ankuranwekar-dev/still-around', // repository page
  },

  /// A tip jar, not a checkout. Ko-fi, Buy Me a Coffee and GitHub Sponsors all
  /// work; leave blank to hide the donate section entirely.
  donateUrl: '',
  donateLabel: 'Buy me a coffee',

  /// Cookieless analytics — how many people came and roughly from where, and
  /// nothing else. No cookies, no identifiers, no consent banner, because there
  /// is nothing to consent to.
  ///
  /// 'vercel' is first-party: the script is served from this same domain at
  /// /_vercel/insights, so no request leaves for anyone else and an ad-blocker
  /// has nothing to block. It needs Web Analytics switched on for the project.
  /// 'plausible' is the alternative if the site ever moves off Vercel; set
  /// `domain` for that one. 'none' turns it off, and the page says so.
  analytics: {
    // Switched off until Web Analytics is enabled for the project in the Vercel
    // dashboard — until then /_vercel/insights/script.js 404s, and the page must
    // not claim to be counting visits when it is not. Change to 'vercel' after
    // enabling and redeploy; nothing else needs to change.
    provider: 'none',     // 'vercel' | 'plausible' | 'none'
    domain: '',           // plausible only, e.g. 'stillaround.online'
    src: 'https://plausible.io/js/script.js',
  },
}
