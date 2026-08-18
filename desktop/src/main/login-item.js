// Opening at login, on both platforms.
//
// The earlier Mac-only version of this project wrote a LaunchAgent plist by hand,
// because it ran from a source checkout: Electron's own API would have registered
// the raw Electron binary, which shows up in System Settings as "Electron" and
// breaks whenever node_modules is rebuilt. A packaged app has none of those
// problems — it is a real .app and a real .exe — so the built-in API is correct
// here and works the same on Windows.

import { app } from 'electron'

export function getOpenAtLogin () {
  try {
    return app.getLoginItemSettings().openAtLogin === true
  } catch {
    return false
  }
}

export async function setOpenAtLogin (on) {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(on),
      // Start hidden: the pets appear on the desktop, and there is no window that
      // should come to the front when someone logs in.
      openAsHidden: true,
      args: [],
    })
  } catch (err) {
    console.error('[still-around] could not change the login item:', err.message)
  }
}
