// The settings window's bridge.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('settingsBridge', {
  read: () => ipcRenderer.invoke('settings:read'),
  /// A partial patch of the settings object; the main process merges and saves.
  set: patch => ipcRenderer.send('settings:set', patch),
  setOpenAtLogin: on => ipcRenderer.send('settings:open-at-login', on),
  togglePet: (id, on) => ipcRenderer.send('settings:toggle-pet', { id, on }),
  renamePet: id => ipcRenderer.send('settings:rename-pet', id),
  forgetPet: id => ipcRenderer.send('settings:forget-pet', id),
  addPet: () => ipcRenderer.send('settings:add-pet'),
  openFile: () => ipcRenderer.send('settings:open-file'),
  onState: handler => ipcRenderer.on('settings:state', (_e, payload) => handler(payload)),
})
