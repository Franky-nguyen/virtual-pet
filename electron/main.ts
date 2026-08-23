import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execSync, spawn, spawnSync, ChildProcess } from 'node:child_process';
import { existsSync, createWriteStream, writeFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } from 'electron'
import WebSocket from 'ws'

// ---------------------------------------------------------------------------
// Cross-platform background process cleanup. Called on window close AND from
// the tray "Quit PosturePet" handler — taskkill with /T kills the process tree
// (including the detector's children), pkill -9 uses SIGKILL on POSIX.
// ---------------------------------------------------------------------------
const killBackgroundProcesses = () => {
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /T /IM python.exe', { stdio: 'ignore' })
      execSync('taskkill /F /T /IM detector.exe', { stdio: 'ignore' })
      execSync('taskkill /F /T /IM node.exe', { stdio: 'ignore' })
    } else {
      execSync('pkill -9 -f "detector.py"', { stdio: 'ignore' })
      execSync('pkill -9 -f "vite"', { stdio: 'ignore' })
    }
  } catch (e) {
    // Ignore errors if processes are already dead
  }
}

// ── OS-aware Python backend launcher ─────────────────────────────────────────
// start.bat / start.sh normally launch detector.py with the platform-correct
// interpreter. This fallback does the same when the app is launched directly
// (e.g. the packaged binary) and the backend is absent: it picks `python` on
// Windows and `python3` on macOS/Linux, and starts the detector only when the
// posture server was never reachable — so it can never double-spawn when the
// launcher already started the backend.
const isWindows = process.platform === 'win32'

// Resolve a usable Python interpreter without ever throwing: probe the common
// commands for the host OS (Windows: python -> py -> python3; macOS/Linux:
// python3 -> python) with `--version` and pick the first that answers.
// Probing with `--version` also avoids triggering the Windows Store alias,
// which only pops open when run with no arguments.
const resolvePythonCmd = (): string | null => {
  const candidates = isWindows ? ['python', 'py', 'python3'] : ['python3', 'python']
  for (const cmd of candidates) {
    try {
      const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 5000 })
      if (probe.status === 0) return cmd
    } catch {
      // Command not found or unusable — try the next candidate.
    }
  }
  return null
}

const pythonCmd = resolvePythonCmd()
const detectorPath = path.join(__dirname, '../detector.py')
// Crash log lives next to the detector in dev (project root) and next to the
// executable in packaged builds — app.asar is read-only, so the log cannot
// live beside detectorPath there.
const detectorLogPath = app.isPackaged
  ? path.join(path.dirname(app.getPath('exe')), 'detector_error.log')
  : path.join(path.dirname(detectorPath), 'detector_error.log')
let backendConnected = false
let detectorSpawned = false
// Stores the spawned detector process so cleanupDetector can target its exact PID.
let pythonProcess: ChildProcess | null = null

// ---------------------------------------------------------------------------
// Targeted PID-tree kill for the detector process.
// IMPORTANT: Must use execSync (blocking) — exec is async and the Node.js
// runtime exits before the shell command runs, leaving detector.exe alive.
// execSync guarantees the kill completes before Electron finishes quitting.
// ---------------------------------------------------------------------------
const cleanupDetector = () => {
  // 1. Targeted kill by PID — handles the PyInstaller bootloader + its child.
  if (pythonProcess && pythonProcess.pid) {
    try {
      execSync(`taskkill /pid ${pythonProcess.pid} /T /F`, { stdio: 'ignore' })
    } catch (_) {
      // Process may have already exited — not an error.
    }
    pythonProcess = null
  }
  // 2. Belt-and-suspenders: image-name kill catches any stale instance whose
  //    PID handle we may have lost (e.g. crash + respawn, dev hot-reload).
  try {
    execSync('taskkill /F /T /IM detector.exe', { stdio: 'ignore' })
  } catch (_) {
    // No detector.exe running — ignore.
  }
}

const startDetector = () => {
  if (detectorSpawned) return
  detectorSpawned = true

  // Packaged build: spawn the PyInstaller-compiled binary shipped in the
  // installer's resources folder — no Python installation required.
  if (app.isPackaged) {
    const exePath = path.join(process.resourcesPath, 'detector.exe')
    if (!existsSync(exePath)) {
      const msg = `Packaged detector not found at ${exePath}`
      console.error(msg)
      writeFileSync(detectorLogPath, msg)
      return
    }
    console.log(`Starting posture detector: ${exePath}`)
    const logStream = createWriteStream(detectorLogPath, { flags: 'w' });
    pythonProcess = spawn(exePath, [], { stdio: ['ignore', 'ignore', 'pipe'] });
    const proc = pythonProcess;
    proc.stderr?.pipe(logStream);
    proc.on('error', (err) => {
      console.error('Failed to start posture detector:', err.message)
      writeFileSync(detectorLogPath, `Failed to start detector.exe: ${err.message}`);
    });
    return
  }

  // Development: run detector.py with the resolved Python interpreter.
  if (!pythonCmd) {
    const msg = 'No Python 3 interpreter found (tried python/py/python3) — install it from https://www.python.org/downloads/'
    console.error(msg)
    writeFileSync(detectorLogPath, msg)
    return
  }
  if (!existsSync(detectorPath)) {
    const msg = `Posture detector not found at ${detectorPath}`
    console.error(msg)
    writeFileSync(detectorLogPath, msg)
    return
  }
  console.log(`Starting posture detector: ${pythonCmd} ${detectorPath}`)
  // Pipe stderr to a log file in the local game folder so Python crash
  // tracebacks (missing cv2/websockets/etc.) are captured instead of
  // vanishing behind stdio: 'ignore'.
  const logStream = createWriteStream(detectorLogPath, { flags: 'w' });
  pythonProcess = spawn(pythonCmd, [detectorPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  const proc = pythonProcess;
  proc.stderr?.pipe(logStream);
  proc.on('error', (err) => {
    console.error('Failed to start posture detector:', err.message)
    writeFileSync(detectorLogPath, `Failed to start python: ${err.message}`);
  });
}

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
// Top-level references prevent garbage collection (Tray vanishes otherwise)
// and track the dashboard window bounds so we can restore them later.
let tray: Tray | null = null
let dashboardBounds: Electron.Rectangle | null = null

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
    backendConnected = true
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
    // Backend never came up (direct launch, no launcher script) — start it now
    // with the OS-correct Python interpreter instead of retrying forever.
    if (!backendConnected && !detectorSpawned) {
      startDetector()
    }
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

  if (mode === 'taskbar') {
    // Save current bounds before shrinking to the pet widget.
    dashboardBounds = mainWindow.getBounds()

    // UNLOCK resizing so Windows doesn't block the shrink — setBounds is
    // ignored on windows created with resizable: false, which made the pet
    // vanish when minimizing.
    mainWindow.setResizable(true)
    if (mainWindow.isMaximized()) mainWindow.unmaximize()

    const workArea = screen.getPrimaryDisplay().workArea
    const winSize = 150
    const targetX = Math.floor(workArea.x + workArea.width - winSize)
    const targetY = Math.floor(workArea.y + workArea.height - winSize)

    mainWindow.setMinimumSize(10, 10)
    mainWindow.setBounds({ x: targetX, y: targetY, width: winSize, height: winSize })

    setTimeout(() => {
      if (!mainWindow) return
      mainWindow.setBounds({ x: targetX, y: targetY, width: winSize, height: winSize })
      mainWindow.setAlwaysOnTop(true)
      mainWindow.setResizable(false) // LOCK it back
    }, 50)

  } else if (mode === 'dashboard') {
    // UNLOCK resizing before restoring
    mainWindow.setResizable(true)
    if (dashboardBounds) {
      mainWindow.setBounds(dashboardBounds)
    } else {
      mainWindow.setSize(380, 620)
      mainWindow.center()
    }
    mainWindow.setAlwaysOnTop(false)
    mainWindow.setResizable(false) // LOCK it back
  }
})

// Forward calibration commands from the renderer to the Python detector.
ipcMain.on('calibrate-posture', () => {
  sendCalibrationCommand()
})

app.whenReady().then(() => {
  createWindow()

  // System tray with context menu. An empty NativeImage is used deliberately
  // so the tray never crashes on a missing asset file.
  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('PosturePet')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open Dashboard',
        click: () => {
          if (!mainWindow) return
          // Restore saved dashboard bounds (if any), show the window, and tell
          // the renderer to switch back to dashboard mode. The window is
          // created with resizable: false, so resizing must be unlocked around
          // setBounds or Windows ignores it and the window vanishes.
          if (dashboardBounds) {
            mainWindow.setResizable(true) // UNLOCK before restoring bounds
            mainWindow.setBounds(dashboardBounds)
            mainWindow.setResizable(false) // LOCK it back
          }
          mainWindow.show()
          mainWindow.setAlwaysOnTop(false)
          mainWindow.webContents.send('set-mode', 'dashboard')
        },
      },
      {
        label: 'Quit PosturePet',
        click: () => {
          // Kill the Python backend and dev servers BEFORE Electron quits;
          // window-all-closed never fires if the window is hidden/closed by
          // app.quit() in some paths, so run the cleanup directly and give
          // the OS half a second to execute the kills before closing Electron.
          killBackgroundProcesses()
          setTimeout(() => app.quit(), 500)
        },
      },
    ])
  )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('will-quit', cleanupDetector)

app.on('window-all-closed', () => {
  // Targeted PID-tree kill for the detector (handles PyInstaller bootloader child).
  cleanupDetector()

  // Quit the application natively.
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
