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

  // Developer debug overlay (Ctrl+Shift+D): toggle annotated-frame streaming
  // from the Python detector. No-op in browsers (the fallback connects
  // directly to the WebSocket and sends the same command itself).
  setDebug: (enabled: boolean) => {
    ipcRenderer.send('set-debug', enabled)
  },

  // Render handshake — renderer → main process: the renderer confirms it has
  // finished painting the new layout so the main process can safely resize the
  // window without racing ahead of the DOM update.
  confirmUIReady: (targetMode: 'dashboard' | 'taskbar') => {
    ipcRenderer.send('ui-ready', targetMode)
  },

  // Force-taskbar-ui: sent from the main process when the tray's "Minimize to
  // Tray" shrinks the window. The renderer switches to the floating-widget layout.
  onForceTaskbarUI: (callback: () => void) => {
    ipcRenderer.on('force-taskbar-ui', () => {
      console.log('[IPC] Preload received force-taskbar-ui')
      callback()
    })
  },

  // Window mode change notifications — main process → renderer
  // Dedicated channel so the main process can push the actual new mode
  // to the renderer without the guard-condition bugs of the old onSetMode.
  onModeChanged: (callback: (mode: 'dashboard' | 'taskbar') => void) => {
    ipcRenderer.on('mode-changed', (_event, mode) => callback(mode))
  },

  // Persistent save file (health & XP)
  loadSave: () => ipcRenderer.invoke('load-save'),
  writeSave: (data: any) => ipcRenderer.send('write-save', data),

  // System notification (debug menu test button)
  notify: (title: string, body: string) => {
    ipcRenderer.send('notify', title, body)
  }
})
