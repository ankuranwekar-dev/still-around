// Still Around, on the desktop.
//
// The whole app is a transparent always-on-top window covering the work area,
// plus a tray menu. The pets themselves are the same code the website runs — the
// engine folder is imported unmodified — so a pet built in a browser looks
// identical here.
//
// It deliberately does not need the website, an account, or a network connection.
// A pet is a small JSON file; opening one is the entire import process.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, protocol, net, dialog, shell } from 'electron'
import { createOverlay, getOverlay, setInteractive, setVisible, send } from './overlay.js'
import { createTray, refreshTray } from './tray.js'
import { loadState, saveState, importPetFile, removePet } from './store.js'
import { setOpenAtLogin, getOpenAtLogin } from './login-item.js'
import { SITE } from '../../../web/config.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')

// Has to happen before the app is ready, and the scheme has to be "standard" and
// "secure" or the renderer's ES modules are refused — relative `import` inside a
// module is only allowed from an origin the loader trusts.
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])

// A single instance only: two overlays would draw two copies of every pet.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    // Opening a .pet file while it is already running should still import.
    // `.json` stays accepted too, for anything saved before the extension changed.
    const file = argv.find(a => isPetFile(a))
    if (file) tryImport(file)
    else setVisible(true)
  })
}

// On macOS an accessory app has no Dock icon and never takes focus.
if (process.platform === 'darwin') app.dock?.hide()

let state = null

// macOS delivers a double-clicked file via the `open-file` Apple Event, which
// can arrive before `whenReady()` resolves — that's the entire point of
// listening for it this early. But `tryImport` touches `state`, the overlay,
// and the tray, none of which exist yet at that point. Every entry into
// `tryImport` waits on this so the earliest possible open-file still lands
// safely instead of throwing on a null `state`.
let markReady
const whenAppReady = new Promise(resolve => { markReady = resolve })

/// The renderer is plain ES modules with relative imports, which `file://` will
/// not load. A tiny custom protocol serves the app directory instead, and refuses
/// anything outside it.
function registerProtocol () {
  protocol.handle('app', request => {
    const url = new URL(request.url)
    const target = path.normalize(path.join(root, decodeURIComponent(url.pathname)))
    if (!target.startsWith(root)) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(`file://${target}`)
  })
}

app.whenReady().then(async () => {
  registerProtocol()
  state = await loadState()

  createOverlay()
  createTray({
    getState: () => state,
    onToggleVisible: visible => { state.visible = visible; saveState(state); setVisible(visible) },
    onSetScale: async scale => {
      state.settings = { ...state.settings, scale }
      await saveState(state)
      pushPets()
      refreshTray()
    },
    onTogglePet: async (id, on) => {
      const pet = state.pets.find(p => p.id === id)
      if (pet) pet.enabled = on
      await saveState(state)
      pushPets()
      refreshTray()
    },
    onImport: async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Open a pet file',
        message: 'Choose the .pet file you saved from the website',
        filters: [{ name: 'Pet', extensions: ['pet', 'json'] }],
        properties: ['openFile'],
      })
      if (!canceled && filePaths[0]) await tryImport(filePaths[0])
    },
    onRemove: async id => {
      state = await removePet(state, id)
      pushPets()
      refreshTray()
    },
    onOpenAtLogin: async on => {
      await setOpenAtLogin(on)
      refreshTray()
    },
    getOpenAtLogin,
    // No domain yet — the repository page is at least a real, working link
    // rather than one pointing nowhere. Update SITE.siteUrl in web/config.js
    // once the site has a home and this follows automatically.
    onMakeOne: () => shell.openExternal(SITE.siteUrl ? `${SITE.siteUrl}#make` : SITE.downloads.source),
    onQuit: () => app.quit(),
  })

  setVisible(state.visible !== false)
  // The renderer asks for its pets once it has booted, but push anyway in case it
  // was already up (a reload, for instance).
  pushPets()

  markReady()

  // A way to see what the overlay is actually painting without needing screen
  // recording permission: the window captures itself. Used only for verification.
  if (process.env.SA_SHOT) {
    setTimeout(async () => {
      const win = getOverlay()
      if (!win) return
      const image = await win.webContents.capturePage()
      await (await import('node:fs')).promises.writeFile(process.env.SA_SHOT, image.toPNG())
      console.log(`[overlay] wrote ${process.env.SA_SHOT}`)
    }, 9000)
  }

  // A file passed on the command line, or dropped on the app icon.
  const fileArg = process.argv.find(a => isPetFile(a))
  if (fileArg) tryImport(fileArg)
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  tryImport(filePath)
})

// Closing the overlay is not quitting: the pets are meant to outlive any window.
app.on('window-all-closed', () => {})

const isPetFile = arg => arg.endsWith('.pet') || arg.endsWith('.json')

async function tryImport (filePath) {
  await whenAppReady
  try {
    state = await importPetFile(state, filePath)
    pushPets()
    refreshTray()
    setVisible(true)
    const pet = state.pets[state.pets.length - 1]
    send('pet:welcome', { id: pet.id, name: pet.name })
  } catch (err) {
    dialog.showMessageBox({
      type: 'warning',
      message: 'That file could not be read as a pet.',
      detail: `${err.message}\n\nPet files come from the "Save my pet file" button on the website.`,
      buttons: ['OK'],
    })
  }
}

function pushPets () {
  send('pets:set', {
    pets: state.pets.filter(p => p.enabled !== false),
    settings: state.settings,
  })
}

// ---- renderer plumbing

ipcMain.handle('pets:get', () => ({
  pets: state.pets.filter(p => p.enabled !== false),
  settings: state.settings,
}))

/// The renderer hit-tests the cursor against the pets' own pixels and tells us
/// whether the window should be solid right now. Without this the overlay would
/// swallow every click on the desktop behind it.
ipcMain.on('overlay:interactive', (_e, on) => setInteractive(Boolean(on)))

ipcMain.on('overlay:log', (_e, message) => {
  if (process.env.SA_DEBUG) console.log(`[renderer] ${message}`)
})

ipcMain.handle('settings:update', async (_e, patch) => {
  state.settings = { ...state.settings, ...patch }
  await saveState(state)
  pushPets()
  return state.settings
})
