import { contextBridge, ipcRenderer } from 'electron'

// Expose API for WebSocket communication and window mode control
contextBridge.exposeInMainWorld('electronAPI', {
  // Posture data methods
  onPostureUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('posture-update', (_event, data) => callback(data))
  },
  removePostureListener: () => {
    ipcRenderer.removeAllListeners('posture-update')
  },
  calibratePosture: () => {
    ipcRenderer.send('calibrate-posture')
  },

  // Window mode control
  setMode: (mode: 'dashboard' | 'taskbar') => {
    ipcRenderer.send('set-mode', mode)
  },
  onSetMode: (callback: (mode: 'dashboard' | 'taskbar') => void) => {
    ipcRenderer.on('set-mode', (_event, mode) => callback(mode))
  },

  // Persistent save file (health & XP)
  loadSave: () => ipcRenderer.invoke('load-save'),
  writeSave: (data: any) => ipcRenderer.send('write-save', data)
})
