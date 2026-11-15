use futures_util::{SinkExt, StreamExt};
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[cfg(windows)]
const DETECTOR_BIN_NAME: &str = "detector.exe";
#[cfg(not(windows))]
const DETECTOR_BIN_NAME: &str = "detector";

/// `CreateProcess` flag that stops a console-subsystem child (taskkill, py.exe,
/// python.exe, ...) from allocating its own console window. Without it, every
/// spawn flashes a black cmd window on screen.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Marks a child process as windowless on Windows. No-op on other platforms.
fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

/// Ensures executable permissions on Unix binaries bundled inside resources.
fn ensure_executable(path: &std::path::Path) {
    #[cfg(unix)]
    {
        if let Ok(meta) = std::fs::metadata(path) {
            let mut perms = meta.permissions();
            let mode = perms.mode();
            if mode & 0o111 == 0 {
                perms.set_mode(mode | 0o755);
                let _ = std::fs::set_permissions(path, perms);
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

pub struct DetectorState {
    pub python_process: Option<Child>,
    pub detector_spawned: bool,
    pub backend_connected: bool,
    pub calibration_pending: bool,
    pub capture_enabled_desired: Option<bool>,
    pub ws_tx: Option<UnboundedSender<String>>,
}

impl Default for DetectorState {
    fn default() -> Self {
        Self {
            python_process: None,
            detector_spawned: false,
            backend_connected: false,
            calibration_pending: false,
            capture_enabled_desired: None,
            ws_tx: None,
        }
    }
}

fn resolve_project_root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.ends_with("src-tauri") {
        cwd.parent().unwrap_or(&cwd).to_path_buf()
    } else {
        cwd
    }
}

fn resolve_python_cmd(
    project_root: &PathBuf,
    app_data_dir: Option<&PathBuf>,
) -> Option<Vec<String>> {
    let mut venv_roots: Vec<PathBuf> = vec![project_root.join("venv"), project_root.join(".venv")];
    if let Some(dir) = app_data_dir {
        venv_roots.push(dir.join("venv"));
    }

    for venv_dir in venv_roots {
        let candidates = if cfg!(windows) {
            vec![venv_dir.join("Scripts").join("python.exe")]
        } else {
            vec![
                venv_dir.join("bin").join("python3"),
                venv_dir.join("bin").join("python"),
            ]
        };
        for py_bin in candidates {
            if py_bin.exists() {
                return Some(vec![py_bin.to_string_lossy().to_string()]);
            }
        }
    }

    let candidates: Vec<Vec<&str>> = if cfg!(windows) {
        vec![
            vec!["py", "-3.12"],
            vec!["py"],
            vec!["python"],
            vec!["python3"],
        ]
    } else {
        vec![
            vec!["python3.12"],
            vec!["python3.11"],
            vec!["python3.10"],
            vec!["python3"],
            vec!["python"],
        ]
    };

    for argv in candidates {
        let mut cmd = Command::new(argv[0]);
        for arg in &argv[1..] {
            cmd.arg(arg);
        }
        no_window(&mut cmd);
        cmd.arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if let Ok(status) = cmd.status() {
            if status.success() {
                return Some(argv.into_iter().map(|s| s.to_string()).collect());
            }
        }
    }
    None
}

pub fn cleanup_detector(app: &AppHandle) {
    let state = app.state::<Mutex<DetectorState>>();
    let mut child_to_kill: Option<Child> = None;

    if let Ok(mut guard) = state.lock() {
        guard.detector_spawned = false;
        guard.backend_connected = false;
        guard.ws_tx = None;
        child_to_kill = guard.python_process.take();
    }

    #[cfg(unix)]
    if let Some(mut child) = child_to_kill {
        let pid = child.id();
        // Terminate child workers spawned by PyInstaller --onefile before killing parent
        // so children are not reparented and port 8765 / webcam handle release immediately.
        let _ = Command::new("pkill")
            .args(["-TERM", "-P", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = child.kill();
        let _ = child.wait();
    }

    #[cfg(windows)]
    {
        if let Some(mut child) = child_to_kill {
            let pid = child.id();
            let _ = child.kill();
            let mut kill_child = Command::new("taskkill");
            no_window(&mut kill_child);
            let _ = kill_child
                .args(["/pid", &pid.to_string(), "/T", "/F"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let mut kill_stale = Command::new("taskkill");
        no_window(&mut kill_stale);
        let _ = kill_stale
            .args(["/F", "/T", "/IM", "detector.exe"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

pub fn start_detector(app: &AppHandle) {
    let state = app.state::<Mutex<DetectorState>>();
    if let Ok(mut guard) = state.lock() {
        if guard.capture_enabled_desired == Some(false) {
            return;
        }
        if guard.detector_spawned {
            return;
        }
        guard.detector_spawned = true;
    }

    let project_root = resolve_project_root();
    let app_data_dir = app.path().app_data_dir().ok();
    let log_path = app_data_dir
        .as_ref()
        .map(|d| {
            let _ = std::fs::create_dir_all(d);
            d.join("detector_error.log")
        })
        .unwrap_or_else(|| project_root.join("detector_error.log"));

    let _ = std::fs::write(&log_path, "");

    let stderr_stdio = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null());

    // 1. Check bundled resource or dev detector binary (detector.exe on Windows, detector on Unix)
    let bundled_exe = app
        .path()
        .resolve(DETECTOR_BIN_NAME, BaseDirectory::Resource)
        .ok()
        .filter(|p| p.exists())
        .or_else(|| {
            let dev_exe = project_root.join(DETECTOR_BIN_NAME);
            if dev_exe.exists() {
                Some(dev_exe)
            } else {
                None
            }
        });

    if let Some(exe_path) = bundled_exe {
        ensure_executable(&exe_path);
        let mut spawn_exe = Command::new(&exe_path);
        no_window(&mut spawn_exe);
        match spawn_exe
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(stderr_stdio)
            .spawn()
        {
            Ok(child) => {
                if let Ok(mut guard) = state.lock() {
                    guard.python_process = Some(child);
                }
                return;
            }
            Err(err) => {
                let warn = format!(
                    "Warning: Failed to start {} ({}): {err}; falling back to Python detector.py\n",
                    DETECTOR_BIN_NAME,
                    exe_path.display()
                );
                if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&log_path) {
                    use std::io::Write;
                    let _ = f.write_all(warn.as_bytes());
                }
            }
        }
    }

    // 2. Fallback: run detector.py from project_root or bundled Resources with resolved Python interpreter
    let detector_py = {
        let local_py = project_root.join("detector.py");
        if local_py.exists() {
            Some(local_py)
        } else {
            app.path()
                .resolve("detector.py", BaseDirectory::Resource)
                .ok()
                .filter(|p| p.exists())
        }
    };

    let Some(detector_py) = detector_py else {
        let msg = format!(
            "Posture detector not found (checked {} and detector.py in {} and Resources)\n",
            DETECTOR_BIN_NAME,
            project_root.display()
        );
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&log_path) {
            use std::io::Write;
            let _ = f.write_all(msg.as_bytes());
        }
        if let Ok(mut guard) = state.lock() {
            guard.detector_spawned = false;
        }
        return;
    };

    let Some(python_cmd) = resolve_python_cmd(&project_root, app_data_dir.as_ref()) else {
        let msg = "No Python 3 interpreter found (tried venv, .venv, app_data/venv, and system python3)\n";
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&log_path) {
            use std::io::Write;
            let _ = f.write_all(msg.as_bytes());
        }
        if let Ok(mut guard) = state.lock() {
            guard.detector_spawned = false;
        }
        return;
    };

    let stderr_stdio_py = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null());

    let mut cmd = Command::new(&python_cmd[0]);
    for arg in &python_cmd[1..] {
        cmd.arg(arg);
    }
    no_window(&mut cmd);
    cmd.arg(&detector_py)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(stderr_stdio_py);

    match cmd.spawn() {
        Ok(child) => {
            if let Ok(mut guard) = state.lock() {
                guard.python_process = Some(child);
            }
        }
        Err(err) => {
            let msg = format!("Failed to start python: {err}\n");
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&log_path) {
                use std::io::Write;
                let _ = f.write_all(msg.as_bytes());
            }
            if let Ok(mut guard) = state.lock() {
                guard.detector_spawned = false;
            }
        }
    }
}

pub fn spawn_posture_ws_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1000)).await;

        {
            let state = app.state::<Mutex<DetectorState>>();
            let should_start = if let Ok(mut guard) = state.lock() {
                if guard.capture_enabled_desired != Some(false) {
                    if guard.capture_enabled_desired.is_none() {
                        guard.capture_enabled_desired = Some(true);
                    }
                    true
                } else {
                    false
                }
            } else {
                false
            };
            if should_start {
                start_detector(&app);
            }
        }

        loop {
            let capture_enabled = {
                let state = app.state::<Mutex<DetectorState>>();
                state
                    .lock()
                    .ok()
                    .and_then(|g| g.capture_enabled_desired)
                    .unwrap_or(true)
            };

            if !capture_enabled {
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }

            match connect_async("ws://localhost:8765").await {
                Ok((ws_stream, _)) => {
                    let (mut write, mut read) = ws_stream.split();
                    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

                    {
                        let state = app.state::<Mutex<DetectorState>>();
                        if let Ok(mut guard) = state.lock() {
                            guard.backend_connected = true;
                            guard.ws_tx = Some(tx.clone());
                            if guard.calibration_pending {
                                let _ = tx.send(r#"{"command":"calibrate"}"#.to_string());
                                guard.calibration_pending = false;
                            }
                            if guard.capture_enabled_desired == Some(false) {
                                let _ =
                                    tx.send(r#"{"command":"capture","enabled":false}"#.to_string());
                            }
                        };
                    }

                    let write_task = tauri::async_runtime::spawn(async move {
                        while let Some(msg) = rx.recv().await {
                            if write.send(Message::Text(msg)).await.is_err() {
                                break;
                            }
                        }
                    });

                    while let Some(msg_res) = read.next().await {
                        match msg_res {
                            Ok(Message::Text(text)) => {
                                if let Ok(json_val) =
                                    serde_json::from_str::<serde_json::Value>(&text)
                                {
                                    let _ = app.emit("posture-update", json_val);
                                }
                            }
                            Ok(Message::Binary(bin)) => {
                                if let Ok(text) = String::from_utf8(bin) {
                                    if let Ok(json_val) =
                                        serde_json::from_str::<serde_json::Value>(&text)
                                    {
                                        let _ = app.emit("posture-update", json_val);
                                    }
                                }
                            }
                            Ok(Message::Close(_)) | Err(_) => break,
                            _ => {}
                        }
                    }

                    write_task.abort();
                    {
                        let state = app.state::<Mutex<DetectorState>>();
                        if let Ok(mut guard) = state.lock() {
                            guard.backend_connected = false;
                            guard.ws_tx = None;
                        };
                    }
                }
                Err(_) => {
                    let need_respawn = {
                        let state = app.state::<Mutex<DetectorState>>();
                        state
                            .lock()
                            .map(|g| {
                                g.capture_enabled_desired != Some(false)
                                    && !g.backend_connected
                                    && !g.detector_spawned
                            })
                            .unwrap_or(false)
                    };
                    if need_respawn {
                        start_detector(&app);
                    }
                }
            }

            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

#[tauri::command]
pub async fn calibrate_posture(app: AppHandle) -> Result<(), String> {
    let state = app.state::<Mutex<DetectorState>>();
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = &guard.ws_tx {
        if tx.send(r#"{"command":"calibrate"}"#.to_string()).is_ok() {
            guard.calibration_pending = false;
            return Ok(());
        }
    }
    guard.calibration_pending = true;
    Ok(())
}

#[tauri::command]
pub async fn set_capture(app: AppHandle, enabled: bool) -> Result<(), String> {
    {
        let state = app.state::<Mutex<DetectorState>>();
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.capture_enabled_desired = Some(enabled);
        if !enabled {
            if let Some(tx) = &guard.ws_tx {
                let _ = tx.send(r#"{"command":"capture","enabled":false}"#.to_string());
            }
        }
    }

    if !enabled {
        cleanup_detector(&app);
        let _ = app.emit(
            "posture-update",
            serde_json::json!({ "status": "unknown" }),
        );
    } else {
        cleanup_detector(&app);
        start_detector(&app);
    }

    Ok(())
}

#[tauri::command]
pub async fn set_debug(app: AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<Mutex<DetectorState>>();
    let guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = &guard.ws_tx {
        let payload = serde_json::json!({
            "command": "debug",
            "enabled": enabled
        })
        .to_string();
        let _ = tx.send(payload);
    }
    Ok(())
}
