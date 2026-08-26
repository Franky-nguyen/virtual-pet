export interface ElectronAPI {
  onPostureUpdate: (callback: (data: PostureData) => void) => void
  removePostureListener: () => void
  calibratePosture: () => void
  setDebug: (enabled: boolean) => void
  /** Render handshake: renderer confirms the new layout has been painted; the
   *  main process then resizes the window (ui-ready channel). */
  confirmUIReady: (targetMode: 'dashboard' | 'taskbar') => void
  /** Main process → renderer: tray "Minimize to Tray" shrink — no args, no guards. */
  onForceTaskbarUI: (callback: () => void) => void
  /** Main process → renderer: pushed when the window mode changes (e.g. tray menu). */
  onModeChanged: (callback: (mode: 'dashboard' | 'taskbar') => void) => void
  loadSave: () => Promise<{ health: number, xp: number }>
  writeSave: (data: { health: number, xp: number }) => void
}

export interface PostureData {
  status: 'good' | 'slouching' | 'away'
  timestamp: number
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
