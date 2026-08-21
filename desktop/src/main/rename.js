// A one-field window, for naming a pet.
//
// Electron has message boxes but no text prompt, and naming the animal is not a
// detail to push into a settings screen — for most people it is the moment the
// drawing stops being a drawing. So it gets its own small window.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, ipcMain } from 'electron'
import { holdOverlayDown, releaseOverlay } from './overlay.js'

const here = path.dirname(fileURLToPath(import.meta.url))

let win = null
let settle = null

/// Resolves to the new name, or null if they closed it or cleared the field.
export function askName (current = '') {
  if (win && !win.isDestroyed()) win.close()

  return new Promise(resolve => {
    settle = resolve
    win = new BrowserWindow({
      width: 380,
      height: 210,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'Name',
      backgroundColor: '#ffffff',
      show: false,
      webPreferences: {
        preload: path.join(here, 'preload-rename.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    holdOverlayDown()
    win.loadURL(`app://bundle/desktop/src/renderer/rename.html?name=${encodeURIComponent(current)}`)
    win.once('ready-to-show', () => win.show())

    win.on('closed', () => {
      releaseOverlay()
      win = null
      // Closing without submitting is a cancel; whoever is waiting still needs an
      // answer or the caller hangs forever.
      if (settle) { settle(null); settle = null }
    })
  })
}

ipcMain.on('rename:submit', (_e, name) => {
  const answer = String(name || '').trim()
  if (settle) { settle(answer || null); settle = null }
  if (win && !win.isDestroyed()) win.close()
})

ipcMain.on('rename:cancel', () => {
  if (win && !win.isDestroyed()) win.close()
})
