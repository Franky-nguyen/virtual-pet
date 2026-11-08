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

  // UC-4 Wellness Mode: ask the detector to power the camera down entirely.
  // The backend releases its VideoCapture handle, so no frames are captured.
  setCapture: (enabled: boolean) => {
    ipcRenderer.send('set-capture', enabled)
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

  // P1 (Ctrl+Alt+H): the window was hidden to the system tray. The renderer
  // pauses the webcam, the Pomodoro timer and BGM while it is hidden.
  onAppHidden: (callback: () => void) => {
    ipcRenderer.on('app-hidden', () => callback())
  },

  // P1: the window was restored from the tray. The renderer restores the camera
  // (unless Wellness Mode is on) and resumes the Pomodoro timer if it was
  // running when the window was hidden.
  onAppRestored: (callback: () => void) => {
    ipcRenderer.on('app-restored', () => callback())
  },

  // Persistent save file (health & XP)
  loadSave: () => ipcRenderer.invoke('load-save'),
  writeSave: (data: any) => ipcRenderer.send('write-save', data),

  // System notification (debug menu test button)
  notify: (title: string, body: string) => {
    ipcRenderer.send('notify', title, body)
  },

  // Custom Pet Pack runtime methods
  listCustomPets: () => ipcRenderer.invoke('custom-pets:list'),
  getCustomPet: (petId: string) => ipcRenderer.invoke('custom-pets:get', petId),
  createCustomPet: (request: any) => ipcRenderer.invoke('custom-pets:create', request),
  importCustomPetDirectory: (meta?: any) => ipcRenderer.invoke('custom-pets:import-directory', meta),
  importFixturePet: (meta?: any) => ipcRenderer.invoke('custom-pets:import-fixture', meta),
  deleteCustomPet: (petId: string) => ipcRenderer.invoke('custom-pets:delete', petId),
  onCustomPetProgress: (callback: (progress: any) => void) => {
    const handler = (_event: any, progress: any) => callback(progress)
    ipcRenderer.on('custom-pets:progress', handler)
    return () => {
      ipcRenderer.removeListener('custom-pets:progress', handler)
    }
  },
})
