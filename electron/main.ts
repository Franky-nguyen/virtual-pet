import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import WebSocket from 'ws'

// ---------------------------------------------------------------------------
// Single-instance lock — prevent duplicate windows
// ---------------------------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // Another instance is already running; quit immediately.
  app.quit()
} else {
  // Focus (and restore) the existing window when a second instance is launched.
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

let mainWindow: BrowserWindow | null = null
let ws: WebSocket | null = null
let calibrationPending = false

const sendCalibrationCommand = () => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ command: 'calibrate' }))
    calibrationPending = false
  } else {
    calibrationPending = true
    console.error('Posture server is not connected; calibration queued')
  }
}

const connectToPostureServer = () => {
  ws = new WebSocket('ws://localhost:8765')

  ws.on('open', () => {
    console.log('Connected to posture detection server')
    if (calibrationPending) {
      sendCalibrationCommand()
    }
  })

  ws.on('message', (data) => {
    // A malformed payload (e.g. from a stale/zombie backend) must never break
    // the message pipeline, so parse defensively and ignore bad frames.
    try {
      const text = typeof data === 'string'
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : Buffer.from(data as ArrayBuffer).toString('utf8')
      const message = JSON.parse(text)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('posture-update', message)
      }
    } catch (error) {
      console.error('Ignoring malformed posture message:', error)
    }
  })

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message)
  })

  ws.on('close', () => {
    console.log('Disconnected from posture server. Retrying in 5s...')
    setTimeout(connectToPostureServer, 5000)
  })
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 620,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // Center window on startup (dashboard mode by default)
  mainWindow.center()

  // Development mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Allow dragging the window
  mainWindow.setIgnoreMouseEvents(false)

  // Connect to posture detection server
  connectToPostureServer()
}

// NOTE: deliberately no cache-busting here. The disappearing-sprite bug is NOT
// caused by Electron caches — the previous attempt wiped them on every launch
// and the sprites still vanished. The sprites are now imported by Vite and
// inlined into the bundle as data URLs, so there is no HTTP request that any
// cache, stale dev server, or restart could break. Keep only the GPU
// shader-disk-cache disabled: transparent, frameless windows render more
// reliably when the compositor does not replay a stale shader cache.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

// Handle mode switching from renderer
ipcMain.on('set-mode', (_event, mode: 'dashboard' | 'taskbar') => {
  if (!mainWindow) return

  if (mode === 'dashboard') {
    // Dashboard mode: larger window, centered, and kept above other apps.
    mainWindow.setSize(380, 620)
    mainWindow.center()
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu')
  } else if (mode === 'taskbar') {
    const winSize = 120
    mainWindow.setSize(winSize, winSize)

    // Get usable screen space; workArea excludes the taskbar.
    const { width, height, x, y } = screen.getPrimaryDisplay().workArea
    mainWindow.setPosition(x + width - winSize - 10, y + height - winSize - 10)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
  }
})

// Forward calibration commands from the renderer to the Python detector.
ipcMain.on('calibrate-posture', () => {
  sendCalibrationCommand()
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (ws) {
    ws.close()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
