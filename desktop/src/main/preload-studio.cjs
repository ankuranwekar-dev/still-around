// The studio window's bridge.
//
// One function wide on purpose. The page inside this window is the public
// website's own code; the only new power it gets from being in the app is the
// ability to hand a finished pet straight to the desktop instead of asking
// someone to download a file and open it again.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('stillDesktop', {
  addPet: pet => ipcRenderer.send('studio:add-pet', pet),
})
