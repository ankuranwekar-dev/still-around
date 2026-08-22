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

  /// Voluntary payment for the software. Not a donation, and the wording is not
  /// decoration.
  ///
  /// Soliciting or promoting donations online from the UAE without a licence
  /// from the Ministry of Community Development is a criminal offence under
  /// Federal Decree-Law 34/2021 — imprisonment and AED 200,000-500,000 — and the
  /// law names websites and donation links explicitly. Paying someone for
  /// software they wrote is an ordinary commercial transaction and needs no
  /// licence at all.
  ///
  /// The whole difference is what is being asked for. Everything below asks
  /// people to support the work. Nothing below names a cause, a charity, an
  /// animal or any use the money will be put to, because naming one turns this
  /// into a fundraising appeal. If you want to fundraise for street cats, get a
  /// permit first, or link to a charity that already holds one; do not edit this
  /// copy into it.
  ///
  /// Any hosted checkout works; a Stripe Payment Link is what this was written
  /// for. In Stripe, describe the item as support for the software — do not use
  /// their "donation" preset, which represents it as the thing it must not be.
  /// Leave blank and every trace of this stays hidden.
  supportUrl: 'https://paypal.me/AnkurAnwekar',
  supportLabel: 'Support this project',
  supportBlurb: 'Still Around is free, and always will be. If it was worth something to you, you can chip in towards the work behind it.',
  supportSmallPrint: 'A voluntary payment for the software — not a charitable donation, and not collected on behalf of any cause or organisation.',

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
    // Web Analytics is enabled for the project (confirmed 2026-08-22:
    // /_vercel/insights/script.js serves 200, not 404).
    provider: 'vercel',   // 'vercel' | 'plausible' | 'none'
    domain: '',           // plausible only, e.g. 'stillaround.online'
    src: 'https://plausible.io/js/script.js',
  },
}
