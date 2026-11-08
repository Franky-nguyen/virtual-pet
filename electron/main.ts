import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execSync, spawn, spawnSync, ChildProcess } from 'node:child_process';
import { existsSync, createWriteStream, writeFileSync, readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, Notification, globalShortcut, dialog } from 'electron'
import WebSocket from 'ws'
import {
  listInstalledPets,
  loadInstalledPet,
  deleteInstalledPet,
  createCustomPetPack,
  importPetPackFromDirectory,
} from './petPackManager'
import type { CreateCustomPetRequest, PetSpecies } from '../src/types/customPet'

// ---------------------------------------------------------------------------
// Cross-platform background process cleanup. Called on window close AND from
// the tray "Quit PosturePet" handler.
// Uses the tracked PID from pythonProcess to kill only this app's backend,
// never touching unrelated system processes by name.
// ---------------------------------------------------------------------------
const killBackgroundProcesses = () => {
  // 1. Targeted PID-tree kill via the tracked process handle — this is the
  // primary cleanup path and covers both the bundled .exe and the python spawn.
  if (pythonProcess && pythonProcess.pid) {
    try {
      execSync(`taskkill /pid ${pythonProcess.pid} /T /F`, { stdio: 'ignore' })
    } catch (_) {
      // Process may have already exited — not an error.
    }
  }
  // 2. Belt-and-suspenders: image-name kill only for detector.exe, which is
  // unique to this project (unlike python.exe / node.exe which are generic).
  // Catches any stale instance whose PID we lost (e.g. crash + respawn).
  try {
    execSync('taskkill /F /T /IM detector.exe', { stdio: 'ignore' })
  } catch (_) {
    // No detector.exe running — ignore.
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
const detectorPath = path.join(__dirname, '../detector.py')

// Resolve a usable Python interpreter without ever throwing. numpy<2 (required
// by cv2/mediapipe) only ships wheels up to Python 3.12, and the default
// `python` on a fresh machine resolves to 3.14 with NumPy 2.x — which crashes
// cv2 at import (`_ARRAY_API not found`). Prefer, in order:
//   1. the project-local Python 3.12 virtualenv created by start.bat /
//      build-installer.bat (`venv\Scripts\python.exe`);
//   2. the `py` launcher pinned to 3.12;
//   3. whatever `py` / `python` / `python3` resolves to, as a last resort.
// Each candidate is probed with `--version` (never with no arguments, which
// would trigger the Windows Store alias).
type PyCommand = string[] // argv: [executable, ...fixed-flags]
const resolvePythonCmd = (): PyCommand | null => {
  const venvPython = isWindows
    ? path.join(path.dirname(detectorPath), 'venv', 'Scripts', 'python.exe')
    : path.join(path.dirname(detectorPath), 'venv', 'bin', 'python')
  if (existsSync(venvPython)) return [venvPython]

  const candidates: string[][] = isWindows
    ? [['py', '-3.12'], ['py'], ['python'], ['python3']]
    : [['python3'], ['python']]
  for (const argv of candidates) {
    try {
      const probe = spawnSync(argv[0], [...argv.slice(1), '--version'], { stdio: 'ignore', timeout: 5000 })
      if (probe.status === 0) return argv
    } catch {
      // Command not found or unusable — try the next candidate.
    }
  }
  return null
}

const pythonCmd = resolvePythonCmd()
// Crash log lives next to the detector in dev (project root) and in the
// always-writable userData dir in packaged builds — app.asar is read-only,
// and the exe's own folder may be non-writable (e.g. per-machine installs),
// where createWriteStream would fail silently and lose the traceback.
const detectorLogPath = app.isPackaged
  ? path.join(app.getPath('userData'), 'detector_error.log')
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
  detectorSpawned = false
  backendConnected = false
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
  if (captureEnabledDesired === false) {
    console.log('[main] startDetector: capture disabled (wellness mode) — skipping')
    return
  }
  if (detectorSpawned) return
  detectorSpawned = true

  // Guard: createWriteStream can throw on read-only filesystems (e.g. some
  // corporate or portable installs). If it fails, log to the console and fall
  // back to ignoring stderr rather than crashing the function and leaving
  // detectorSpawned=true with no process started.
  let logStream: ReturnType<typeof createWriteStream>
  try {
    logStream = createWriteStream(detectorLogPath, { flags: 'w' })
  } catch (err) {
    console.error('[main] startDetector: could not open log file — stderr will not be captured:', err)
    logStream = createWriteStream('/dev/null', { flags: 'w' })
  }

  // Preferred: the PyInstaller-compiled binary — dev: next to this script;
  // packaged: the installer's resources folder. No Python installation
  // required, and it is the artifact of the Python 3.12 build pipeline, so it
  // is immune to the NumPy 2.x / cv2 ABI breakage that crashes source-mode
  // `python detector.py` on newer interpreters.
  const bundledExe = app.isPackaged
    ? path.join(process.resourcesPath, 'detector.exe')
    : path.join(path.dirname(detectorPath), 'detector.exe')
  if (existsSync(bundledExe)) {
    console.log(`Starting posture detector: ${bundledExe}`)
    pythonProcess = spawn(bundledExe, [], { stdio: ['ignore', 'ignore', 'pipe'] })
    const proc = pythonProcess
    proc.stderr?.pipe(logStream)
    proc.on('exit', () => {
      logStream.end()
      detectorSpawned = false
      pythonProcess = null
    })
    proc.on('error', (err) => {
      detectorSpawned = false
      pythonProcess = null
      console.error('Failed to start posture detector:', err.message)
      writeFileSync(detectorLogPath, `Failed to start detector.exe: ${err.message}`)
    })
    return
  }

  // Fallback: run detector.py with the resolved Python interpreter. stderr is
  // piped to a log file so Python crash tracebacks (missing cv2/mediapipe,
  // NumPy ABI mismatch, camera init failure) are captured instead of
  // vanishing behind stdio: 'ignore'.
  if (!pythonCmd) {
    const msg = 'No Python 3 interpreter found (tried venv, py -3.12, py, python, python3) — install it from https://www.python.org/downloads/'
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
  console.log(`Starting posture detector: ${pythonCmd.join(' ')} ${detectorPath}`)
  pythonProcess = spawn(pythonCmd[0], [...pythonCmd.slice(1), detectorPath], { stdio: ['ignore', 'ignore', 'pipe'] })
  const proc = pythonProcess
  proc.stderr?.pipe(logStream)
  proc.on('exit', () => {
    logStream.end()
    detectorSpawned = false
    pythonProcess = null
  })
  proc.on('error', (err) => {
    detectorSpawned = false
    pythonProcess = null
    console.error('Failed to start posture detector:', err.message)
    writeFileSync(detectorLogPath, `Failed to start python: ${err.message}`)
  })
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
    console.log('[main] second-instance: focusing existing window')
    if (hiddenToTray) {
      // The window was hidden via the P1 hotkey; restore through the same path
      // so the renderer resumes the camera / Pomodoro timer it paused.
      showFromTray()
      return
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      // show() covers a hidden window; moveTop() defeats Windows' foreground
      // lock, which otherwise silently ignores focus() from a background
      // process — the classic "clicking the shortcut does nothing" symptom.
      mainWindow.show()
      mainWindow.focus()
      mainWindow.moveTop()
    }
  })
}

let mainWindow: BrowserWindow | null = null
let ws: WebSocket | null = null
let calibrationPending = false
// Desired camera-capture state. null = "no opinion yet" (renderer has not told
// us). Remembered so a Wellness Mode decision made before the socket is up is
// applied the moment the detector connects.
let captureEnabledDesired: boolean | null = null
// Top-level reference prevents garbage collection (Tray vanishes otherwise).
let tray: Tray | null = null

// The dashboard window's fixed launch size. The tray "Open Dashboard" handler
// and the set-mode restore path MUST restore exactly these dimensions — a
// mismatched guess (previously 480×640) reopened the dashboard larger than the
// initial launch size. Always restore via these constants so they can't drift.
const DASHBOARD_WIDTH = 380
const DASHBOARD_HEIGHT = 620

// The floating pet widget size when minimized to taskbar — sized to fit the
// pet circle + timer column in src/App.tsx taskbar mode (180×180).
const TASKBAR_SIZE = 180

// Padding from the bottom-right of the work area when snapping to tray mode.
const TASKBAR_PADDING = 20

// Last layout the renderer confirmed via 'ui-ready'. Used to decide whether a
// native OS minimize should collapse the dashboard into the snapped widget.
let currentMode: 'dashboard' | 'taskbar' = 'dashboard'

// Saved dashboard window position (x, y) prior to minimizing to taskbar widget.
// Updated whenever the dashboard window is moved and right before shrinking, so
// unminimizing always snaps back to the exact original position.
let savedDashboardPosition: { x: number; y: number } | null = null

/** Record the current window position as the dashboard's original position if valid. */
const captureDashboardPosition = (win: BrowserWindow | null = mainWindow) => {
  if (!win || win.isDestroyed() || win.isMinimized()) return
  const b = win.getBounds()
  // Ignore off-screen OS minimize coordinates (-32000, -32000) or taskbar-widget bounds
  if (b.x <= -10000 || b.y <= -10000) return
  if (Math.abs(b.width - DASHBOARD_WIDTH) <= 30 && Math.abs(b.height - DASHBOARD_HEIGHT) <= 30) {
    savedDashboardPosition = { x: b.x, y: b.y }
  }
}

// P1 (Ctrl+Alt+H): the window is hidden to the system tray — NOT the widget
// snap. This is deliberately independent of currentMode: hiding keeps whatever
// layout the renderer is in, and restoring must not resize or re-snap anything.
let hiddenToTray = false

/** Hide the BrowserWindow but keep the app alive in the system tray. The
 *  renderer pauses the webcam, the Pomodoro timer and BGM on 'app-hidden'. */
const hideToTray = () => {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  console.log('[main] hideToTray: hiding window (app stays in tray)')
  hiddenToTray = true
  // Notify BEFORE hiding so the renderer pauses capture/timer/BGM while the
  // renderer is still foregrounded and its timers are not throttled.
  win.webContents.send('app-hidden')
  win.hide()
}

/** Clear the P1 hidden flag and tell the renderer to resume the camera and the
 *  Pomodoro timer. Used by every path that makes a hidden window visible again
 *  (hotkey, tray click, tray menu, second instance) so the renderer is never
 *  left paused after the window reappears. Returns true if it was hidden. */
const notifyRestoredIfHidden = (win: BrowserWindow): boolean => {
  if (!hiddenToTray) return false
  hiddenToTray = false
  win.webContents.send('app-restored')
  return true
}

/** Show + focus the window that was hidden with the global hotkey or tray, and
 *  ask the renderer to restore the camera / Pomodoro timer / BGM state. */
const showFromTray = () => {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  console.log('[main] showFromTray: restoring hidden window')
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.moveTop()
  notifyRestoredIfHidden(win)
}

/** Ctrl+Alt+H toggles hide/restore. Driven only by hiddenToTray so the first
 *  press always hides and the second always restores, regardless of layout. */
const toggleTrayVisibility = () => {
  if (hiddenToTray) {
    showFromTray()
  } else {
    hideToTray()
  }
}

/** Ask the renderer to switch to the floating widget. The renderer flips its
 *  layout, then confirms with 'ui-ready', which runs shrinkToTaskbar() and
 *  snaps the window to the bottom-right corner. The window is woken first and
 *  given 150ms so a throttled (hidden/minimized) renderer can respond. */
const requestTaskbarMode = (win: BrowserWindow) => {
  captureDashboardPosition(win)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  // A P1-hidden window is now visible again — resume what its renderer paused.
  notifyRestoredIfHidden(win)
  setTimeout(() => {
    if (!win || win.isDestroyed()) return
    console.log('[IPC] Sending force-taskbar-ui to renderer')
    win.webContents.send('force-taskbar-ui')
  }, 50)
}

// ── Two-way window-mode bridge ───────────────────────────────────────────────
// shrinkToTaskbar / restoreDashboard are the ONLY code paths that physically
// resize the window, and both are driven exclusively by the renderer's
// 'ui-ready' handshake: the renderer flips its layout FIRST, then confirms the
// DOM has been painted, and only then do we resize — so the OS window can
// never race ahead of the UI (the squish-race). Every step is logged so a
// broken chain is immediately visible in the main-process console.
const shrinkToTaskbar = (): boolean => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.error('[main] shrinkToTaskbar: mainWindow is null — aborting')
    return false
  }
  const initialBounds = mainWindow.getBounds()
  console.log('[main] shrinkToTaskbar: current bounds', initialBounds)

  // Save the dashboard's current position before shrinking so unminimize
  // restores the window back to its exact original position.
  captureDashboardPosition(mainWindow)

  // Windows ignores setBounds on windows created with resizable: false, so we
  // must unlock resizing (and unmaximize/restore) BEFORE changing the bounds.
  console.log('[main] shrinkToTaskbar: unlocking resizable + unmaximizing')
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.setResizable(true)
  if (mainWindow.isMaximized()) mainWindow.unmaximize()

  // Snap to the bottom-right of the work area of the monitor the window is
  // currently on (not always the primary one), clear of the Windows taskbar.
  const refPoint = savedDashboardPosition ?? initialBounds
  const display = (refPoint.x <= -10000 || refPoint.y <= -10000)
    ? screen.getPrimaryDisplay()
    : screen.getDisplayMatching({
        x: refPoint.x,
        y: refPoint.y,
        width: DASHBOARD_WIDTH,
        height: DASHBOARD_HEIGHT,
      })
  const { workArea } = display
  const targetX = Math.round(workArea.x + workArea.width - TASKBAR_SIZE - TASKBAR_PADDING)
  const targetY = Math.round(workArea.y + workArea.height - TASKBAR_SIZE - TASKBAR_PADDING)
  const targetBounds: Electron.Rectangle = {
    x: targetX,
    y: targetY,
    width: TASKBAR_SIZE,
    height: TASKBAR_SIZE,
  }
  console.log('[main] shrinkToTaskbar: workArea', workArea, '-> target bounds', targetBounds)

  // Lower the minimum BELOW the target size first — otherwise Electron/Windows
  // clamps the shrink to the dashboard minimum and the widget never collapses.
  mainWindow.setMinimumSize(100, 100)
  mainWindow.setMaximumSize(0, 0)

  // Physically shrink and snap to the bottom-right of the work area.
  mainWindow.setSize(TASKBAR_SIZE, TASKBAR_SIZE, false)
  mainWindow.setPosition(targetX, targetY, false)
  mainWindow.setBounds(targetBounds, false)

  // Persistent floating widget: pin it above nearly everything ('screen-saver'
  // level is only honored on macOS but is harmless on Windows) and follow
  // virtual-desktop switches so the pet is never buried or lost.
  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.setVisibleOnAllWorkspaces(true)
  // Physically pop the widget onto the screen, overriding any OS-minimized or
  // hidden state, so the pet is immediately visible as the floating widget.
  mainWindow.show()
  mainWindow.focus()

  // setBounds can be applied asynchronously on Windows; re-apply after a tick
  // and re-lock resizing so the pet widget can't be accidentally resized.
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    console.log('[main] shrinkToTaskbar: re-applying bounds (async safety)')
    mainWindow.setResizable(true)
    mainWindow.setMinimumSize(100, 100)
    mainWindow.setSize(TASKBAR_SIZE, TASKBAR_SIZE, false)
    mainWindow.setPosition(targetX, targetY, false)
    mainWindow.setBounds(targetBounds, false)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.setResizable(false)
    console.log('[main] shrinkToTaskbar: done — bounds now', mainWindow.getBounds())
    // Notify renderer AFTER window is confirmed at new size — prevents a render
    // cycle into a still-tiny window (the race that caused cut-off UI on the
    // "Minimize to Tray" tray path).
    mainWindow.webContents.send('mode-changed', 'taskbar')
  }, 50)

  return true
}

const restoreDashboard = (): boolean => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.error('[main] restoreDashboard: mainWindow is null — aborting')
    return false
  }
  console.log('[main] restoreDashboard: current bounds', mainWindow.getBounds())
  console.log('[main] restoreDashboard: unlocking resizable + unmaximizing')
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.setResizable(true)
  if (mainWindow.isMaximized()) mainWindow.unmaximize()

  // Explicitly raise the minimum BEFORE resizing so Windows accepts the larger
  // dashboard size (a previous shrink left the minimum at 100×100).
  mainWindow.setMinimumSize(DASHBOARD_WIDTH, DASHBOARD_HEIGHT)
  mainWindow.setMaximumSize(0, 0)
  console.log('[main] restoreDashboard: setMinimumSize', DASHBOARD_WIDTH, 'x', DASHBOARD_HEIGHT)

  // Compute the target dashboard bounds: snap back to savedDashboardPosition
  // (clamped within the display's workArea so it can never land off-screen),
  // or center on the primary display if no saved position exists yet.
  let restoreX: number
  let restoreY: number
  if (savedDashboardPosition) {
    const display = screen.getDisplayMatching({
      x: savedDashboardPosition.x,
      y: savedDashboardPosition.y,
      width: DASHBOARD_WIDTH,
      height: DASHBOARD_HEIGHT,
    })
    const { workArea } = display
    const maxX = Math.max(workArea.x, workArea.x + workArea.width - DASHBOARD_WIDTH)
    const maxY = Math.max(workArea.y, workArea.y + workArea.height - DASHBOARD_HEIGHT)
    restoreX = Math.min(Math.max(workArea.x, Math.round(savedDashboardPosition.x)), maxX)
    restoreY = Math.min(Math.max(workArea.y, Math.round(savedDashboardPosition.y)), maxY)
  } else {
    const { workArea } = screen.getPrimaryDisplay()
    restoreX = Math.round(workArea.x + (workArea.width - DASHBOARD_WIDTH) / 2)
    restoreY = Math.round(workArea.y + (workArea.height - DASHBOARD_HEIGHT) / 2)
    savedDashboardPosition = { x: restoreX, y: restoreY }
  }

  const restoreBounds: Electron.Rectangle = {
    x: restoreX,
    y: restoreY,
    width: DASHBOARD_WIDTH,
    height: DASHBOARD_HEIGHT,
  }

  // Enforce the exact dashboard size and restore to its original position.
  mainWindow.setSize(DASHBOARD_WIDTH, DASHBOARD_HEIGHT, false)
  mainWindow.setPosition(restoreX, restoreY, false)
  mainWindow.setBounds(restoreBounds, false)
  console.log('[main] restoreDashboard: restored to original bounds', restoreBounds)

  // Bring the window back and take it off the always-on-top layer so the main
  // dashboard acts like a normal window again (and stops following virtual
  // desktops).
  mainWindow.setAlwaysOnTop(false)
  mainWindow.setVisibleOnAllWorkspaces(false)
  mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()

  // Re-lock resizing for dashboard mode (prevents accidental resize).
  mainWindow.setResizable(false)
  console.log('[main] restoreDashboard: done — bounds now', mainWindow.getBounds())

  // Windows can apply the resize asynchronously after unlocking resizing —
  // re-assert the exact size and original position after a tick so the restore
  // is bulletproof.
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    console.log('[main] restoreDashboard: re-asserting size + original position', restoreBounds)
    mainWindow.setResizable(true)
    mainWindow.setMinimumSize(DASHBOARD_WIDTH, DASHBOARD_HEIGHT)
    mainWindow.setSize(DASHBOARD_WIDTH, DASHBOARD_HEIGHT, false)
    mainWindow.setPosition(restoreX, restoreY, false)
    mainWindow.setBounds(restoreBounds, false)
    mainWindow.setResizable(false)
    mainWindow.webContents.send('mode-changed', 'dashboard')
  }, 50)

  return true
}

const sendCalibrationCommand = () => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ command: 'calibrate' }))
    calibrationPending = false
  } else {
    calibrationPending = true
    console.error('Posture server is not connected; calibration queued')
  }
}

let reconnectTimer: NodeJS.Timeout | null = null

const connectToPostureServer = () => {
  if (captureEnabledDesired === false) {
    console.log('[main] connectToPostureServer: capture disabled (wellness mode) — staying disconnected')
    return
  }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }
  ws = new WebSocket('ws://localhost:8765')

  ws.on('open', () => {
    backendConnected = true
    console.log('Connected to posture detection server')
    if (calibrationPending) {
      sendCalibrationCommand()
    }
    // Re-apply a Wellness Mode decision that was made while offline.
    if (captureEnabledDesired === false) {
      ws?.send(JSON.stringify({ command: 'capture', enabled: false }))
      console.log('[main] set-capture: applied deferred disable on connect')
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
    // Reset so reconnect can re-spawn the detector if the backend died.
    backendConnected = false
  })

  ws.on('close', () => {
    backendConnected = false
    ws = null
    if (captureEnabledDesired === false) {
      console.log('[main] Posture server closed while capture disabled — staying disconnected')
      return
    }
    console.log('Disconnected from posture server. Retrying in 5s...')
    if (!backendConnected && !detectorSpawned) {
      startDetector()
    }
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connectToPostureServer, 5000)
  })
}

// Resolve the app icon for the window taskbar button and the system-tray
// notification-area icon. Tries the packaged location first (dist/icon.png
// inside the asar, copied there from public/ at build time), then the dev-tree
// public/ folder. Falls back to an empty image — invisible, never crashes.
const resolveAppIcon = () => {
  const candidates = [
    path.join(__dirname, '../dist/icon.png'),       // packaged / post-build
    path.join(__dirname, '../public/icon.png'),  // vite dev tree
  ]
  return nativeImage.createFromPath(candidates.find((p) => existsSync(p)) ?? '')
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: DASHBOARD_WIDTH,
    height: DASHBOARD_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    // Explicit taskbar icon: without this, Windows shows a generic Electron
    // icon (and skipTaskbar: true used to remove the taskbar button entirely).
    icon: resolveAppIcon(),
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      backgroundThrottling: true,
    }
  })

  // Center window on startup (dashboard mode by default) and record its initial position
  mainWindow.center()
  captureDashboardPosition(mainWindow)

  // Track user drags in dashboard mode so unminimizing from taskbar mode always
  // snaps back to the exact last position the dashboard had.
  const onDashboardMove = () => {
    if (currentMode === 'dashboard' && !hiddenToTray) {
      captureDashboardPosition(mainWindow)
    }
  }
  mainWindow.on('move', onDashboardMove)
  mainWindow.on('moved', onDashboardMove)

  // Development mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Allow dragging the window
  mainWindow.setIgnoreMouseEvents(false)

  // Any path that makes the window visible again (taskbar-button click, dock
  // activate, OS-level restore) must also lift the P1 pause, otherwise the
  // renderer would keep the camera and Pomodoro timer paused behind a visible
  // window. Idempotent: it only fires when hiddenToTray is set.
  mainWindow.on('show', () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    notifyRestoredIfHidden(win)
  })

  // Native minimize (taskbar-button click, Win+Down, etc.)
  // Snaps the app into the floating widget at the bottom-right of the screen.
  mainWindow.on('minimize', () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    console.log('[main] native minimize -> snapping to bottom-right widget')
    win.restore()
    win.show()
    win.focus()
    setTimeout(() => {
      if (!win || win.isDestroyed()) return
      win.restore()
      win.show()
      win.focus()
    }, 50)

    if (currentMode === 'dashboard') {
      currentMode = 'taskbar'
      requestTaskbarMode(win)
    } else {
      shrinkToTaskbar()
    }
  })

  // Connect to posture detection server after a short delay so the renderer can
  // report its saved Wellness Mode state before we spawn the camera detector.
  setTimeout(() => {
    if (captureEnabledDesired !== false) {
      if (captureEnabledDesired === null) captureEnabledDesired = true
      startDetector()
      connectToPostureServer()
    }
  }, 1000)
}

// NOTE: deliberately no cache-busting here. The disappearing-sprite bug is NOT
// caused by Electron caches — the previous attempt wiped them on every launch
// and the sprites still vanished. The sprites are now imported by Vite and
// inlined into the bundle as data URLs, so there is no HTTP request that any
// cache, stale dev server, or restart could break. Keep only the GPU
// shader-disk-cache disabled: transparent, frameless windows render more
// reliably when the compositor does not replay a stale shader cache.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('renderer-process-limit', '1')
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128')

// Render handshake — renderer → main process. The renderer confirms it has
// finished painting the new layout (taskbar widget or dashboard) BEFORE we
// resize the window, so the OS window can never race ahead of the DOM update.
ipcMain.on('ui-ready', (_event, targetMode: 'dashboard' | 'taskbar') => {
  console.log('[main] IPC "ui-ready" received:', targetMode, '(currentMode:', currentMode, ')')
  if (targetMode === 'taskbar') {
    if (currentMode === 'dashboard') {
      captureDashboardPosition(mainWindow)
    }
    currentMode = 'taskbar'
    shrinkToTaskbar()
  } else if (targetMode === 'dashboard') {
    const wasTaskbar = currentMode === 'taskbar'
    currentMode = 'dashboard'
    if (!wasTaskbar && mainWindow && !mainWindow.isDestroyed()) {
      const b = mainWindow.getBounds()
      if (Math.abs(b.width - DASHBOARD_WIDTH) <= 10 && Math.abs(b.height - DASHBOARD_HEIGHT) <= 10) {
        captureDashboardPosition(mainWindow)
        return
      }
    }
    restoreDashboard()
  } else {
    console.warn('[main] ui-ready: unknown mode —', targetMode)
  }
})

// Forward calibration commands from the renderer to the Python detector.
ipcMain.on('calibrate-posture', () => {
  sendCalibrationCommand()
})

// UC-4: Wellness Mode asks the detector to release the camera. The backend
// process is genuinely terminated so the hardware/driver releases the webcam LED.
ipcMain.on('set-capture', (_event, enabled: boolean) => {
  console.log('[main] set-capture received:', enabled)
  captureEnabledDesired = !!enabled

  if (!captureEnabledDesired) {
    // Wellness Mode active: release camera completely
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ command: 'capture', enabled: false }))
      } catch (_) {}
    }
    if (ws) {
      try {
        ws.removeAllListeners()
        ws.close()
      } catch (_) {}
      ws = null
      backendConnected = false
    }
    // Genuinely terminate the detector process so OpenCV / Windows driver releases the webcam
    cleanupDetector()
    // Tell renderer posture is unknown
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('posture-update', { status: 'unknown' })
    }
  } else {
    // Camera mode enabled: start detector and reconnect
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    cleanupDetector()
    startDetector()
    setTimeout(() => {
      if (captureEnabledDesired) {
        connectToPostureServer()
      }
    }, 1000)
  }
})

// Forward debug-stream toggles from the renderer to the Python detector
// (Ctrl+Shift+D in the dashboard). The backend only annotates/encodes frames
// while at least one client has debug enabled, which keeps CPU at zero when
// the overlay is closed.
ipcMain.on('set-debug', (_event, enabled: boolean) => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ command: 'debug', enabled }))
  }
})

// Debug menu: fire a system notification (tests the OS notification path).
ipcMain.on('notify', (_event, title?: string, body?: string) => {
  if (!Notification.isSupported()) {
    console.warn('[main] notify: system notifications are not supported on this platform')
    return
  }
  new Notification({
    title: title || 'PosturePet',
    body: body || 'Notification test from the debug menu.',
  }).show()
})

// ── Save/Load persistence (health & XP) ──────────────────────────────────────
// Persists pet save data to app.getPath('userData')/save-data.json in
// packaged builds, and to the project root in dev mode (app.isPackaged is
// false before app.whenReady, so the path is set eagerly for dev only).
const saveDataPath = app.isPackaged
  ? path.join(app.getPath('userData'), 'save-data.json')
  : path.join(__dirname, '..', 'save-data.json')

const isValidSave = (raw: unknown): raw is { health: number; xp: number } =>
  typeof raw === 'object' &&
  raw !== null &&
  typeof (raw as any).health === 'number' &&
  Number.isFinite((raw as any).health) &&
  typeof (raw as any).xp === 'number' &&
  Number.isFinite((raw as any).xp)

ipcMain.handle('load-save', async () => {
  try {
    if (existsSync(saveDataPath)) {
      const raw = readFileSync(saveDataPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (isValidSave(parsed)) {
        return { health: parsed.health, xp: parsed.xp }
      }
      console.warn('[main] load-save: save file has invalid shape — ignoring:', parsed)
    }
  } catch (err) {
    console.error('[main] load-save: failed to read save file:', err)
  }
  // Corrupt or missing — renderer falls back to its own defaults (health:100, xp:0).
  return null
})

ipcMain.on('write-save', (_event, data: unknown) => {
  if (!isValidSave(data)) {
    console.error('[main] write-save: rejected invalid data shape:', data)
    return
  }
  // Write only the two validated fields — no arbitrary keys.
  try {
    writeFileSync(saveDataPath, JSON.stringify({ health: data.health, xp: data.xp }, null, 2), 'utf8')
  } catch (err) {
    console.error('[main] write-save: failed to write save file:', err)
  }
})

// ── Custom Pet Pack IPC Handlers ─────────────────────────────────────────────
ipcMain.handle('custom-pets:list', async () => {
  return listInstalledPets()
})

ipcMain.handle('custom-pets:get', async (_event, petId: unknown) => {
  if (typeof petId !== 'string') return null
  return loadInstalledPet(petId)
})

ipcMain.handle('custom-pets:create', async (_event, request: CreateCustomPetRequest) => {
  return createCustomPetPack(request, (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('custom-pets:progress', progress)
    }
  })
})

ipcMain.handle(
  'custom-pets:import-directory',
  async (_event, meta?: { name?: string; species?: PetSpecies; breed?: string }) => {
    const win = mainWindow
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: 'Select Custom Pet Sprite Pack Folder',
          properties: ['openDirectory'],
        })
      : await dialog.showOpenDialog({
          title: 'Select Custom Pet Sprite Pack Folder',
          properties: ['openDirectory'],
        })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, code: 'INVALID_INPUT', error: 'Folder selection was cancelled.' }
    }
    return importPetPackFromDirectory(result.filePaths[0], meta)
  },
)

ipcMain.handle(
  'custom-pets:import-fixture',
  async (_event, meta?: { name?: string; species?: PetSpecies; breed?: string }) => {
    const fixtureCandidates = [
      app.isPackaged ? path.join(process.resourcesPath, 'fixtures/mochi-cat-pack') : '',
      path.join(__dirname, '../fixtures/mochi-cat-pack'),
    ].filter(Boolean)
    const fixtureDir = fixtureCandidates.find((p) => existsSync(p))
    if (fixtureDir) {
      return importPetPackFromDirectory(fixtureDir, {
        name: meta?.name?.trim() || 'Mochi',
        species: meta?.species || 'cat',
        breed: meta?.breed?.trim() || 'Calico',
      })
    }
    return createCustomPetPack(
      {
        name: meta?.name?.trim() || 'Mochi',
        species: meta?.species || 'cat',
        breed: meta?.breed?.trim() || 'Calico',
        photos: [],
        pipeline: 'fixture',
      },
      (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('custom-pets:progress', progress)
        }
      },
    )
  },
)

ipcMain.handle('custom-pets:delete', async (_event, petId: unknown) => {
  if (typeof petId !== 'string') return { ok: false }
  try {
    const deleted = deleteInstalledPet(petId)
    return { ok: deleted }
  } catch (err) {
    console.error('[main] custom-pets:delete error:', err)
    return { ok: false }
  }
})

app.whenReady().then(() => {
  // A duplicate instance that failed the lock must quit WITHOUT creating
  // anything — no window, no tray — so it can't leak a renderer process or
  // touch the running instance's shared detector via cleanupDetector.
  if (!gotTheLock) return

  createWindow()

  // System tray with context menu. The pet sprite doubles as the tray icon so
  // the app has a visible presence in the notification area (falls back to an
  // invisible empty image if the asset is ever missing — never crashes).
  tray = new Tray(resolveAppIcon())
  tray.setToolTip('PosturePet')
  // P1: clicking the tray icon while the window is hidden to the tray brings it
  // back. A click when the window is already visible is left alone (it must not
  // hide the window — that is the hotkey's job).
  tray.on('click', () => {
    if (hiddenToTray) showFromTray()
  })
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Minimize to Tray',
        click: () => {
          console.log('[main] Tray "Minimize to Tray" clicked')
          const win = mainWindow
          if (!win) return

          // Force the window awake and to the front, regardless of its
          // current state (VBS launches run invisibly, so the renderer can be
          // throttled even when the window is not technically minimized), then
          // wait 150ms for Chromium to un-throttle before React transitions.
          requestTaskbarMode(win)
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
    } else if (mainWindow) {
      // Clicked from the dock/taskbar while already running — bring it to the front.
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // P1: Ctrl+Alt+H global hide/restore. Registration can legitimately fail
  // (the combo is already taken by another app, or the platform refuses it);
  // warn and keep running — the tray icon and tray click still work.
  try {
    const registered = globalShortcut.register('CommandOrControl+Alt+H', () => {
      console.log('[main] global shortcut CommandOrControl+Alt+H')
      toggleTrayVisibility()
    })
    if (!registered) {
      console.warn('[main] could not register global shortcut CommandOrControl+Alt+H (already in use?) — continue without it')
    }
  } catch (err) {
    console.warn('[main] global shortcut registration threw — continue without it:', err)
  }
})

app.on('will-quit', () => {
  // Release the P1 global hotkey so it is not left bound after the app exits.
  globalShortcut.unregisterAll()
  // Only the lock-holding instance owns the detector; a duplicate that is
  // quitting must not touch it (cleanupDetector's image-name kill would
  // also terminate the running instance's detector.exe).
  if (!gotTheLock) return
  cleanupDetector()
})

app.on('window-all-closed', () => {
  // Same quarantine: a duplicate that never opened a window must not kill the
  // running instance's detector while quitting itself.
  if (!gotTheLock) return

  // Targeted PID-tree kill for the detector (handles PyInstaller bootloader child).
  cleanupDetector()

  // Quit the application natively.
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
