// The naming window's bridge. Two messages: here is the name, or never mind.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('rename', {
  submit: name => ipcRenderer.send('rename:submit', name),
  cancel: () => ipcRenderer.send('rename:cancel'),
})
