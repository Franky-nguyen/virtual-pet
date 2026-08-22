export interface ElectronAPI {
  onPostureUpdate: (callback: (data: PostureData) => void) => void
  removePostureListener: () => void
  calibratePosture: () => void
  setMode: (mode: 'dashboard' | 'taskbar') => void
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
