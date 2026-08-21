// The only bridge between the overlay renderer and the main process. Deliberately
// four functions wide: the renderer draws pets and reports where the cursor is,
// and nothing else needs to cross this boundary.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('still', {
  getPets: () => ipcRenderer.invoke('pets:get'),
  onPets: handler => ipcRenderer.on('pets:set', (_e, payload) => handler(payload)),
  onWelcome: handler => ipcRenderer.on('pet:welcome', (_e, payload) => handler(payload)),
  setInteractive: on => ipcRenderer.send('overlay:interactive', on),
  /// Right-click landed on a pet. The menu itself is native, so it has to be
  /// built in the main process; the renderer only says which pet was hit.
  contextMenu: info => ipcRenderer.send('overlay:context-menu', info),
  openSettings: () => ipcRenderer.send('overlay:open-settings'),
  onCommand: handler => ipcRenderer.on('pet:command', (_e, payload) => handler(payload)),
  log: message => ipcRenderer.send('overlay:log', String(message)),
})
