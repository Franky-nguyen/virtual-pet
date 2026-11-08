import type {
  CreateCustomPetRequest,
  CreateCustomPetResult,
  PetCreationProgress,
  PetSpecies,
  RuntimeCustomPet,
} from './customPet'

export interface ElectronAPI {
  onPostureUpdate: (callback: (data: PostureData) => void) => void
  removePostureListener: () => void
  calibratePosture: () => void
  /** UC-4: enable/disable the backend camera. false releases the VideoCapture
   *  handle so the webcam hardware is unpowered (Wellness Mode). */
  setCapture: (enabled: boolean) => void
  setDebug: (enabled: boolean) => void
  /** Render handshake: renderer confirms the new layout has been painted; the
   *  main process then resizes the window (ui-ready channel). */
  confirmUIReady: (targetMode: 'dashboard' | 'taskbar') => void
  /** Main process → renderer: tray "Minimize to Tray" shrink — no args, no guards. */
  onForceTaskbarUI: (callback: () => void) => void
  /** Main process → renderer: pushed when the window mode changes (e.g. tray menu). */
  onModeChanged: (callback: (mode: 'dashboard' | 'taskbar') => void) => void
  /** P1: main process → renderer: the window was hidden to the system tray
   *  (Ctrl+Alt+H). Pause the camera, Pomodoro timer and BGM. */
  onAppHidden: (callback: () => void) => void
  /** P1: main process → renderer: the window was restored from the tray.
   *  Restore the camera and resume the Pomodoro timer if it was running. */
  onAppRestored: (callback: () => void) => void
  loadSave: () => Promise<{ health: number; xp: number }>
  writeSave: (data: { health: number; xp: number }) => void
  /** Fire a system notification (debug menu test button). */
  notify: (title: string, body: string) => void

  // Custom Pet Pack runtime methods
  listCustomPets: () => Promise<RuntimeCustomPet[]>
  getCustomPet: (petId: string) => Promise<RuntimeCustomPet | null>
  createCustomPet: (request: CreateCustomPetRequest) => Promise<CreateCustomPetResult>
  importCustomPetDirectory: (meta?: {
    name?: string
    species?: PetSpecies
    breed?: string
  }) => Promise<CreateCustomPetResult>
  importFixturePet: (meta?: {
    name?: string
    species?: PetSpecies
    breed?: string
  }) => Promise<CreateCustomPetResult>
  deleteCustomPet: (petId: string) => Promise<{ ok: boolean }>
  onCustomPetProgress: (callback: (progress: PetCreationProgress) => void) => () => void
}

export interface SlouchScores {
  neck: number
  lowerBack: number
  shoulder: number
}

export interface PostureData {
  status: 'good' | 'slouching' | 'away'
  timestamp: number
  neck?: number
  lowerBack?: number
  shoulder?: number
  scores?: SlouchScores
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
