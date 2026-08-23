export interface ElectronAPI {
  onPostureUpdate: (callback: (data: PostureData) => void) => void
  removePostureListener: () => void
  calibratePosture: () => void
  setMode: (mode: 'dashboard' | 'taskbar') => void
  onSetMode: (callback: (mode: 'dashboard' | 'taskbar') => void) => void
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
