// The welcome window's bridge. Separate from the overlay's preload on purpose:
// that one is deliberately four functions wide and has no business gaining a
// "open a file dialog" button just because another window needed one.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('welcome', {
  // What to draw on open: the instructions, or the finish line if pets exist.
  getState: () => ipcRenderer.invoke('welcome:state'),
  create: () => ipcRenderer.send('welcome:create'),
  makeOne: () => ipcRenderer.send('welcome:make-one'),
  openFile: () => ipcRenderer.send('welcome:open-file'),
  close: () => ipcRenderer.send('welcome:close'),
  // The window fits itself to whichever view is showing.
  setHeight: height => ipcRenderer.send('welcome:height', height),
  onImported: handler => ipcRenderer.on('welcome:imported', (_e, payload) => handler(payload)),
})
