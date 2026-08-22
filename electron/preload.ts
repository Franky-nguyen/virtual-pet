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
  }
})
