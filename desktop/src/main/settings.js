// The settings window.
//
// Everything adjustable in one place, the way the first version of this had it.
// The tray menu keeps the handful of things worth reaching in one click; this is
// where the rest lives, including the things a menu is bad at — a size that is
// really a slider, and a list of pets you want to see all at once.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow } from 'electron'
import { holdOverlayDown, releaseOverlay } from './overlay.js'

const here = path.dirname(fileURLToPath(import.meta.url))

let win = null

export function showSettings () {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return win
  }

  win = new BrowserWindow({
    width: 520,
    height: 700,
    resizable: true,
    minWidth: 460,
    minHeight: 520,
    maximizable: false,
    fullscreenable: false,
    title: 'Still Around Settings',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload-settings.cjs'),
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

  holdOverlayDown()
  win.loadURL('app://bundle/desktop/src/renderer/settings.html')
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => { releaseOverlay(); win = null })
  return win
}

export function getSettingsWindow () {
  return win && !win.isDestroyed() ? win : null
}

/// Push fresh state so the window redraws itself. Called whenever anything
/// changes it from the outside — the tray's own Size menu, a rename from the
/// pet's context menu — so the two never disagree about what is switched on.
export function refreshSettings (payload) {
  if (win && !win.isDestroyed()) win.webContents.send('settings:state', payload)
}
