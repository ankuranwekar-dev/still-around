// The only bridge between the overlay renderer and the main process. Deliberately
// four functions wide: the renderer draws pets and reports where the cursor is,
// and nothing else needs to cross this boundary.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('still', {
  getPets: () => ipcRenderer.invoke('pets:get'),
  onPets: handler => ipcRenderer.on('pets:set', (_e, payload) => handler(payload)),
  onWelcome: handler => ipcRenderer.on('pet:welcome', (_e, payload) => handler(payload)),
  setInteractive: on => ipcRenderer.send('overlay:interactive', on),
  log: message => ipcRenderer.send('overlay:log', String(message)),
})
