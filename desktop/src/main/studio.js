// The studio window — making a pet without leaving the app.
//
// It loads the website's own page from inside the bundle and lets it run in
// studio-only mode. That is the whole trick: guided capture, the segmentation
// models, the likeness editor and the sliders are difficult, and they already
// exist and are tested. A second native implementation of them would be the
// Swift port's mistake repeated — it drifts, and the drift is invisible until
// someone's pet comes out wrong in one of the two.
//
// Nothing is uploaded here any more than on the site: the photos are read in this
// window and never sent anywhere. The model weights are the one thing fetched
// from the network, once, and the classical cutout still works without them.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow } from 'electron'
import { holdOverlayDown, releaseOverlay } from './overlay.js'

const here = path.dirname(fileURLToPath(import.meta.url))

let win = null

export function showStudio () {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return win
  }

  win = new BrowserWindow({
    width: 980,
    height: 860,
    minWidth: 720,
    minHeight: 620,
    title: 'Make a pet',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload-studio.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Same reason as the welcome window: the overlay's 'screen-saver' level would
  // otherwise sit on top of this and eat every click.
  holdOverlayDown()

  win.loadURL('app://bundle/web/index.html')
  win.once('ready-to-show', () => win.show())

  win.on('closed', () => {
    releaseOverlay()
    win = null
  })

  return win
}

export function closeStudio () {
  if (win && !win.isDestroyed()) win.close()
}

export function getStudio () {
  return win && !win.isDestroyed() ? win : null
}
