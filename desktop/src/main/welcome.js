// The welcome window — the only part of the app that explains itself.
//
// It exists because of a gap the tray menu could not close: a pet is made on the
// website, not in here, and nothing on a freshly installed accessory app says so.
// The app has no Dock icon and opens no window, so a first launch looked
// identical to nothing happening at all.
//
// It is deliberately not a settings window. It shows the three steps, hands over
// the two buttons that start them, and closes for good once a pet arrives.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow } from 'electron'
import { holdOverlayDown, releaseOverlay } from './overlay.js'

const here = path.dirname(fileURLToPath(import.meta.url))

let win = null
// Messages sent before the page finishes loading would land on a renderer that has
// not registered its listeners yet and vanish. That is the normal case when a pet
// arrives from the studio and this window is being opened to announce it.
let ready = false
let pending = []

export function showWelcome () {
  // Reopening from the tray while it is already up should just bring it forward.
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return win
  }

  win = new BrowserWindow({
    width: 560,
    height: 740,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    // Native traffic lights over our own layout, rather than a titled bar that
    // would put a second "Still Around" above the one in the page.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    title: 'Still Around',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload-welcome.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Sandboxed. contextIsolation already separates the worlds, but with
      // sandbox off a preload runs with full Node, so any contextIsolation bypass
      // becomes arbitrary code on the machine. These preloads only ever use
      // contextBridge and ipcRenderer, both of which work sandboxed, so there is
      // nothing to trade away for it.
      sandbox: true,
    },
  })

  // Without this the overlay's 'screen-saver' level would sit on top of this
  // window and swallow its clicks — the same trap the file dialog fell into.
  holdOverlayDown()

  ready = false
  pending = []
  win.webContents.on('did-finish-load', () => {
    ready = true
    for (const [channel, payload] of pending) win.webContents.send(channel, payload)
    pending = []
  })

  win.loadURL('app://bundle/desktop/src/renderer/welcome.html')
  win.once('ready-to-show', () => win.show())

  win.on('closed', () => {
    releaseOverlay()
    ready = false
    pending = []
    win = null
  })

  return win
}

/// The finish screen is much shorter than the instructions. Rather than pad it
/// out to match, the window shrinks to it — otherwise the "done" state is mostly
/// a void, which reads as something failing to load.
export function resizeWelcome (height) {
  if (!win || win.isDestroyed()) return
  const [width] = win.getSize()
  const [x, y] = win.getPosition()
  const grew = height - win.getSize()[1]
  win.setBounds({ x, y: Math.max(0, y + Math.round(grew / -2)), width, height }, true)
}

export function closeWelcome () {
  if (win && !win.isDestroyed()) win.close()
}

/// The live window, or null. Callers use it to parent a dialog to this window so
/// it opens as a sheet on it rather than as a loose window of its own.
export function getWelcome () {
  return win && !win.isDestroyed() ? win : null
}

/// Lets the main process tell an open welcome window that a pet just landed, so
/// it can show the finish line instead of the instructions.
export function sendWelcome (channel, payload) {
  if (!win || win.isDestroyed()) return
  if (!ready) pending.push([channel, payload])
  else win.webContents.send(channel, payload)
}
