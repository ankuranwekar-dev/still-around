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
import { app, BrowserWindow, Menu, ipcMain, protocol, net, dialog, shell } from 'electron'
import {
  createOverlay, getOverlay, setInteractive, setVisible, send,
  holdOverlayDown, releaseOverlay,
} from './overlay.js'
import { showWelcome, closeWelcome, sendWelcome, getWelcome, resizeWelcome } from './welcome.js'
import { showStudio, closeStudio, getStudio } from './studio.js'
import { createTray, refreshTray, SIZES } from './tray.js'
import { askName } from './rename.js'
import { showSettings, refreshSettings } from './settings.js'
import { loadState, saveState, importPet, importPetFile, removePet } from './store.js'
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

// The Dock icon stays. Hiding it made this an accessory app, which is tidy right
// up until someone switches to another window: there is then no way back — no
// Dock icon, nothing in Cmd-Tab, and the only route to the app is hunting for a
// small paw in the menu bar. The overlay window is `focusable: false`, so the
// pets still never steal focus; that was the part worth keeping.

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
    onSetScale: setScale,
    onTogglePet: togglePet,
    onImport: openPetFile,
    onRename: renamePet,
    onRemove: forgetPet,
    onOpenAtLogin: async on => {
      await setOpenAtLogin(on)
      refreshTray()
      refreshSettings(settingsPayload())
    },
    onSettings: () => showSettings(),
    getOpenAtLogin,
    // Falls back to the repository page only if the site has no domain set —
    // SITE.siteUrl in web/config.js drives this and the welcome window alike.
    onMakeOne: () => showStudio(),
    onWebsite: () => shell.openExternal(SITE.siteUrl ? `${SITE.siteUrl}#make` : SITE.downloads.source),
    onWelcome: () => showWelcome(),
    onQuit: () => app.quit(),
  })

  setVisible(state.visible !== false)
  // The renderer asks for its pets once it has booted, but push anyway in case it
  // was already up (a reload, for instance).
  pushPets()

  markReady()

  // First launch has no pets, no Dock icon and no window — without this the app
  // looks like it did not start. Shown once; the tray keeps it reachable after.
  if (!state.welcomed && state.pets.length === 0) {
    state.welcomed = true
    await saveState(state)
    showWelcome()
  }

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

// Switching to the app — Cmd-Tab, or clicking the Dock icon — has to show
// something, or it looks broken. The welcome window doubles as the app's home:
// it greets a newcomer and reminds everyone else where the controls live.
app.on('activate', () => {
  if (getStudio()) getStudio().focus()
  else showWelcome()
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  tryImport(filePath)
})

// Closing the overlay is not quitting: the pets are meant to outlive any window.
app.on('window-all-closed', () => {})

const isPetFile = arg => arg.endsWith('.pet') || arg.endsWith('.json')

// The overlay sits at 'screen-saver' level so it floats above full-screen apps —
// but that also floats it above any native dialog, which opens at the normal
// window level and would otherwise be buried, unreachable, underneath it. Drop
// the overlay back down for the dialog's lifetime and restore it after.
async function withDialogsVisible (run) {
  holdOverlayDown()
  try {
    return await run()
  } finally {
    releaseOverlay()
  }
}

/// Everything that changes state funnels through here, so the tray, the settings
/// window and the pets themselves are never showing three different truths.
function settingsPayload () {
  return {
    pets: state.pets.map(p => ({ id: p.id, name: p.name, enabled: p.enabled !== false })),
    settings: state.settings,
    openAtLogin: getOpenAtLogin(),
  }
}

function broadcast () {
  pushPets()
  refreshTray()
  refreshSettings(settingsPayload())
}

async function setScale (scale) {
  state.settings = { ...state.settings, scale }
  await saveState(state)
  broadcast()
}

async function togglePet (id, on) {
  const pet = state.pets.find(p => p.id === id)
  if (pet) pet.enabled = on
  await saveState(state)
  broadcast()
}

async function forgetPet (id) {
  state = await removePet(state, id)
  broadcast()
}

async function patchSettings (patch) {
  state.settings = { ...state.settings, ...patch }
  await saveState(state)
  broadcast()
}

/// Renaming happens in both menus and reaches the overlay straight away, so the
/// speech bubble and the menus agree about who this is.
async function renamePet (id) {
  const pet = state.pets.find(p => p.id === id)
  if (!pet) return
  const name = await askName(pet.name)
  if (!name || name === pet.name) return
  pet.name = name
  await saveState(state)
  broadcast()
  sendWelcome('welcome:renamed', { id, name })
}

/// Asking for the file, from either the tray or the welcome window's button.
async function openPetFile () {
  const options = {
    title: 'Open a pet file',
    message: 'Choose the .pet file you saved from the website',
    filters: [{ name: 'Pet', extensions: ['pet', 'json'] }],
    properties: ['openFile'],
  }
  // Parented to the welcome window when that is what asked, so it arrives as a
  // sheet attached to it instead of a separate window to go hunting for.
  const parent = getWelcome()
  const { canceled, filePaths } = await withDialogsVisible(() =>
    parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options))
  if (!canceled && filePaths[0]) await tryImport(filePaths[0])
}

async function tryImport (filePath) {
  await whenAppReady
  try {
    state = await importPetFile(state, filePath)
    pushPets()
    refreshTray()
    setVisible(true)
    const pet = state.pets[state.pets.length - 1]
    send('pet:welcome', { id: pet.id, name: pet.name })
    // If the welcome window is open it is mid-explanation; tell it the journey
    // finished so it can show this pet instead of instructions for getting one.
    sendWelcome('welcome:imported', { name: pet.name, appearance: pet.appearance })
  } catch (err) {
    await withDialogsVisible(() => dialog.showMessageBox({
      type: 'warning',
      message: 'That file could not be read as a pet.',
      detail: `${err.message}\n\nPet files come from the "Save my pet file" button on the website.`,
      buttons: ['OK'],
    }))
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

/// The pet's own menu. Everything here is something to do *to that animal*;
/// anything that is really an app setting stays in the tray, so the two menus do
/// not become two half-copies of each other.
ipcMain.on('overlay:open-settings', () => showSettings())

ipcMain.on('overlay:context-menu', (_e, info) => {
  const overlay = getOverlay()
  if (!overlay) return
  const pet = state.pets.find(p => p.id === info.id)
  if (!pet) return
  const command = c => () => send('pet:command', { id: info.id, command: c, at: info.at })

  Menu.buildFromTemplate([
    { label: pet.name, enabled: false },
    { type: 'separator' },
    { label: 'Come here', click: command('come') },
    { label: 'Say something', click: command('speak') },
    { label: 'Have a stretch', click: command('stretch') },
    { label: 'Have a wash', click: command('groom') },
    { label: 'Time for a nap', click: command('sleep') },
    { type: 'separator' },
    { label: `Rename ${pet.name}…`, click: () => renamePet(pet.id) },
    {
      label: 'Size',
      submenu: SIZES.map(size => ({
        label: size.label,
        type: 'radio',
        checked: Math.abs(size.value - (state.settings?.scale ?? 0.175)) < 0.001,
        click: () => setScale(size.value),
      })),
    },
    { type: 'separator' },
    { label: 'Settings…', accelerator: 'Command+,', click: () => showSettings() },
    { label: 'Hide for now', click: () => { state.visible = false; saveState(state); setVisible(false); broadcast() } },
    { label: `Forget ${pet.name}`, click: () => forgetPet(pet.id) },
  ]).popup({ window: overlay })
})

// ---- settings window

ipcMain.handle('settings:read', () => settingsPayload())
ipcMain.on('settings:set', (_e, patch) => { patchSettings(patch) })
ipcMain.on('settings:toggle-pet', (_e, { id, on }) => { togglePet(id, on) })
ipcMain.on('settings:rename-pet', (_e, id) => { renamePet(id) })
ipcMain.on('settings:forget-pet', (_e, id) => { forgetPet(id) })
ipcMain.on('settings:add-pet', () => showStudio())
ipcMain.on('settings:open-file', () => openPetFile())
ipcMain.on('settings:open-at-login', async (_e, on) => {
  await setOpenAtLogin(on)
  broadcast()
})

ipcMain.on('overlay:log', (_e, message) => {
  if (process.env.SA_DEBUG) console.log(`[renderer] ${message}`)
})

ipcMain.handle('settings:update', async (_e, patch) => {
  state.settings = { ...state.settings, ...patch }
  await saveState(state)
  pushPets()
  return state.settings
})

// ---- welcome window

ipcMain.handle('welcome:state', () => ({
  hasPets: state.pets.length > 0,
  // Sent so the window can draw one of their own animals rather than the stock
  // tabby, when it is opened again after there are pets to show.
  firstPet: state.pets[0] ? { name: state.pets[0].name, appearance: state.pets[0].appearance } : null,
}))

ipcMain.on('welcome:create', () => showStudio())

ipcMain.on('welcome:make-one', () => {
  shell.openExternal(SITE.siteUrl ? `${SITE.siteUrl}#make` : SITE.downloads.source)
})

/// A pet finished in the studio window. Same landing as a file import, minus the
/// file: validated, saved, shown, and the studio gets out of the way.
ipcMain.on('studio:add-pet', async (_e, pet) => {
  try {
    state = await importPet(state, pet)
  } catch (err) {
    await withDialogsVisible(() => dialog.showMessageBox({
      type: 'warning',
      message: 'That pet could not be saved.',
      detail: String(err.message || err),
      buttons: ['OK'],
    }))
    return
  }
  pushPets()
  refreshTray()
  setVisible(true)
  const added = state.pets[state.pets.length - 1]
  send('pet:welcome', { id: added.id, name: added.name })
  closeStudio()
  // The welcome window is usually what sent them here, so it shows the finish
  // line; if it was closed, showWelcome brings it back for the one screen that
  // says where the app now lives.
  showWelcome()
  sendWelcome('welcome:imported', { name: added.name, appearance: added.appearance })
})

ipcMain.on('welcome:open-file', () => openPetFile())

ipcMain.on('welcome:close', () => closeWelcome())

ipcMain.on('welcome:height', (_e, height) => {
  // Clamped: this arrives from a renderer, and an absurd value would leave the
  // window unusable with no way back to it but deleting the saved state.
  if (Number.isFinite(height)) resizeWelcome(Math.max(320, Math.min(1000, Math.round(height))))
})
