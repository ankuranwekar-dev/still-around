// The overlay: a transparent, always-on-top window covering the desktop.
//
// The trick that makes the pets clickable without the overlay eating every click
// on the desktop: the window ignores mouse events by default but *forwards* them,
// so the renderer still receives mousemove. When the cursor crosses onto a pet's
// actual pixels the renderer calls back and we stop ignoring; when it leaves, we
// start again. Net effect — the pets are solid, and the rest of the screen might
// as well not have a window over it.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, screen } from 'electron'

const here = path.dirname(fileURLToPath(import.meta.url))

let win = null
let interactive = false

export function createOverlay () {
  const { workArea } = screen.getPrimaryDisplay()

  win = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    // Non-focusable keeps the pets from stealing focus from whatever is actually
    // being worked in. The window still receives forwarded mouse events.
    focusable: false,
    acceptFirstMouse: true,
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  // 'screen-saver' level floats above full-screen apps too.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true })

  // There are no devtools on a click-through overlay, so renderer messages come
  // out on stdout instead. The signature of this event changed across Electron
  // majors, hence the defensive unpacking.
  win.webContents.on('console-message', (...args) => {
    const d = args[0]
    const message = typeof d === 'object' && d?.message ? d.message : args[1]
    const level = typeof d === 'object' && d?.level ? d.level : 'log'
    if (level === 'error' || level === 'warning' || process.env.SA_DEBUG) {
      console.log(`[renderer:${level}] ${message}`)
    }
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[still-around] renderer gone:', details.reason)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[still-around] failed to load ${url}: ${desc} (${code})`)
  })

  win.loadURL('app://bundle/desktop/src/renderer/index.html')
  win.once('ready-to-show', () => {
    win.showInactive()
    if (process.env.SA_DEBUG) {
      const report = () => console.log(
        `[overlay] visible=${win.isVisible()} bounds=${JSON.stringify(win.getBounds())} ` +
        `opacity=${win.getOpacity()} alwaysOnTop=${win.isAlwaysOnTop()}`)
      report()
      setTimeout(report, 3000)
    }
  })

  // Follow the work area if displays change underneath us.
  const refit = () => {
    if (!win || win.isDestroyed()) return
    win.setBounds(screen.getPrimaryDisplay().workArea)
  }
  screen.on('display-metrics-changed', refit)
  screen.on('display-added', refit)
  screen.on('display-removed', refit)

  win.on('closed', () => { win = null })
  return win
}

export function getOverlay () { return win }

// The overlay floats at 'screen-saver' level so it clears full-screen apps — which
// also puts it above every ordinary window, including this app's own dialogs and
// the welcome window. Anything showing real UI holds the overlay down for its
// lifetime. Counted rather than a boolean because these nest: opening the file
// dialog *from* the welcome window would otherwise let the dialog's release pop
// the overlay back over the still-open window behind it.
let floatHolds = 0

export function holdOverlayDown () {
  floatHolds += 1
  if (floatHolds === 1 && win && !win.isDestroyed()) win.setAlwaysOnTop(false)
}

export function releaseOverlay () {
  floatHolds = Math.max(0, floatHolds - 1)
  if (floatHolds === 0 && win && !win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver')
}

/** Called from the renderer as the cursor crosses onto or off a pet. */
export function setInteractive (on) {
  if (!win || win.isDestroyed() || on === interactive) return
  interactive = on
  win.setIgnoreMouseEvents(!on, { forward: true })
}

export function setVisible (visible) {
  if (!win || win.isDestroyed()) return
  if (visible) win.showInactive()
  else win.hide()
}

export function send (channel, payload) {
  if (!win || win.isDestroyed()) return
  win.webContents.send(channel, payload)
}
