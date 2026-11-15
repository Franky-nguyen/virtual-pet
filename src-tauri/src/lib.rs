pub mod custom_pets;
pub mod detector;
pub mod png_codec;

use custom_pets::{
    custom_pets_create, custom_pets_delete, custom_pets_get, custom_pets_import_directory,
    custom_pets_import_fixture, custom_pets_list,
};
use detector::{
    calibrate_posture, cleanup_detector, set_capture, set_debug, spawn_posture_ws_loop,
    DetectorState,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

pub const DASHBOARD_WIDTH: f64 = 380.0;
pub const DASHBOARD_HEIGHT: f64 = 620.0;
pub const TASKBAR_SIZE: f64 = 180.0;
pub const TASKBAR_PADDING: f64 = 20.0;

pub struct WindowModeState {
    pub current_mode: String,
    pub saved_dashboard_position: Option<(i32, i32)>,
    pub hidden_to_tray: bool,
}

impl Default for WindowModeState {
    fn default() -> Self {
        Self {
            current_mode: "dashboard".to_string(),
            saved_dashboard_position: None,
            hidden_to_tray: false,
        }
    }
}

pub fn capture_dashboard_position(win: &WebviewWindow, state: &Mutex<WindowModeState>) {
    if win.is_minimized().unwrap_or(false) {
        return;
    }
    if let (Ok(pos), Ok(size), Ok(scale)) = (
        win.outer_position(),
        win.outer_size(),
        win.scale_factor(),
    ) {
        if pos.x <= -10000 || pos.y <= -10000 {
            return;
        }
        let logical_w = size.width as f64 / scale;
        let logical_h = size.height as f64 / scale;
        if (logical_w - DASHBOARD_WIDTH).abs() <= 30.0
            && (logical_h - DASHBOARD_HEIGHT).abs() <= 30.0
        {
            if let Ok(mut guard) = state.lock() {
                guard.saved_dashboard_position = Some((pos.x, pos.y));
            }
        }
    }
}

pub fn notify_restored_if_hidden(win: &WebviewWindow, state: &Mutex<WindowModeState>) -> bool {
    if let Ok(mut guard) = state.lock() {
        if !guard.hidden_to_tray {
            return false;
        }
        guard.hidden_to_tray = false;
    } else {
        return false;
    }
    let _ = win.emit("app-restored", ());
    true
}

pub fn hide_to_tray(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let state = app.state::<Mutex<WindowModeState>>();
    if let Ok(mut guard) = state.lock() {
        guard.hidden_to_tray = true;
    }
    let _ = win.emit("app-hidden", ());
    let _ = win.hide();
}

pub fn show_from_tray(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let state = app.state::<Mutex<WindowModeState>>();
    if win.is_minimized().unwrap_or(false) {
        let _ = win.unminimize();
    }
    let _ = win.show();
    let _ = win.set_focus();
    notify_restored_if_hidden(&win, &state);
}

pub fn toggle_tray_visibility(app: &AppHandle) {
    let state = app.state::<Mutex<WindowModeState>>();
    let is_hidden = state
        .lock()
        .map(|g| g.hidden_to_tray)
        .unwrap_or(false);
    if is_hidden {
        show_from_tray(app);
    } else {
        hide_to_tray(app);
    }
}

pub fn request_taskbar_mode(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let state = app.state::<Mutex<WindowModeState>>();
    capture_dashboard_position(&win, &state);
    if win.is_minimized().unwrap_or(false) {
        let _ = win.unminimize();
    }
    let _ = win.show();
    let _ = win.set_focus();
    notify_restored_if_hidden(&win, &state);

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        if let Some(w) = app_clone.get_webview_window("main") {
            let _ = w.emit("force-taskbar-ui", ());
        }
    });
}

pub fn shrink_to_taskbar(app: &AppHandle) -> Result<bool, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    let state = app.state::<Mutex<WindowModeState>>();

    capture_dashboard_position(&win, &state);

    if win.is_minimized().unwrap_or(false) {
        let _ = win.unminimize();
    }
    let _ = win.set_resizable(true);
    if win.is_maximized().unwrap_or(false) {
        let _ = win.unmaximize();
    }

    let monitor = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten());

    let scale = win.scale_factor().unwrap_or(1.0);
    let (target_x, target_y) = if let Some(m) = monitor {
        let work_area = m.work_area();
        let size_phys = (TASKBAR_SIZE * scale).round() as i32;
        let pad_phys = (TASKBAR_PADDING * scale).round() as i32;
        let x = work_area.position.x + work_area.size.width as i32 - size_phys - pad_phys;
        let y = work_area.position.y + work_area.size.height as i32 - size_phys - pad_phys;
        (x, y)
    } else {
        (100, 100)
    };

    let _ = win.set_min_size(Some(LogicalSize::new(100.0, 100.0)));
    let _ = win.set_max_size(None::<LogicalSize<f64>>);
    let _ = win.set_size(LogicalSize::new(TASKBAR_SIZE, TASKBAR_SIZE));
    let _ = win.set_position(PhysicalPosition::new(target_x, target_y));
    let _ = win.set_always_on_top(true);
    let _ = win.set_visible_on_all_workspaces(true);
    let _ = win.show();
    let _ = win.set_focus();

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        if let Some(w) = app_clone.get_webview_window("main") {
            let _ = w.set_resizable(true);
            let _ = w.set_min_size(Some(LogicalSize::new(100.0, 100.0)));
            let _ = w.set_size(LogicalSize::new(TASKBAR_SIZE, TASKBAR_SIZE));
            let _ = w.set_position(PhysicalPosition::new(target_x, target_y));
            let _ = w.set_always_on_top(true);
            let _ = w.set_resizable(false);
            let _ = w.emit("mode-changed", "taskbar");
        }
    });

    Ok(true)
}

pub fn restore_dashboard(app: &AppHandle) -> Result<bool, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    let state = app.state::<Mutex<WindowModeState>>();

    if win.is_minimized().unwrap_or(false) {
        let _ = win.unminimize();
    }
    let _ = win.set_resizable(true);
    if win.is_maximized().unwrap_or(false) {
        let _ = win.unmaximize();
    }

    let _ = win.set_min_size(Some(LogicalSize::new(DASHBOARD_WIDTH, DASHBOARD_HEIGHT)));
    let _ = win.set_max_size(None::<LogicalSize<f64>>);

    let scale = win.scale_factor().unwrap_or(1.0);
    let dash_w_phys = (DASHBOARD_WIDTH * scale).round() as i32;
    let dash_h_phys = (DASHBOARD_HEIGHT * scale).round() as i32;

    let saved_pos = state.lock().ok().and_then(|g| g.saved_dashboard_position);
    let monitor = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten());

    let (restore_x, restore_y) = if let Some((sx, sy)) = saved_pos {
        if let Some(m) = monitor {
            let wa = m.work_area();
            let max_x = (wa.position.x + wa.size.width as i32 - dash_w_phys).max(wa.position.x);
            let max_y = (wa.position.y + wa.size.height as i32 - dash_h_phys).max(wa.position.y);
            (sx.clamp(wa.position.x, max_x), sy.clamp(wa.position.y, max_y))
        } else {
            (sx, sy)
        }
    } else if let Some(m) = monitor {
        let wa = m.work_area();
        let rx = wa.position.x + (wa.size.width as i32 - dash_w_phys) / 2;
        let ry = wa.position.y + (wa.size.height as i32 - dash_h_phys) / 2;
        if let Ok(mut guard) = state.lock() {
            guard.saved_dashboard_position = Some((rx, ry));
        }
        (rx, ry)
    } else {
        (200, 200)
    };

    let _ = win.set_size(LogicalSize::new(DASHBOARD_WIDTH, DASHBOARD_HEIGHT));
    let _ = win.set_position(PhysicalPosition::new(restore_x, restore_y));
    let _ = win.set_always_on_top(false);
    let _ = win.set_visible_on_all_workspaces(false);
    let _ = win.show();
    let _ = win.set_focus();
    let _ = win.set_resizable(false);

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        if let Some(w) = app_clone.get_webview_window("main") {
            let _ = w.set_resizable(true);
            let _ = w.set_min_size(Some(LogicalSize::new(DASHBOARD_WIDTH, DASHBOARD_HEIGHT)));
            let _ = w.set_size(LogicalSize::new(DASHBOARD_WIDTH, DASHBOARD_HEIGHT));
            let _ = w.set_position(PhysicalPosition::new(restore_x, restore_y));
            let _ = w.set_resizable(false);
            let _ = w.emit("mode-changed", "dashboard");
        }
    });

    Ok(true)
}

#[tauri::command]
async fn ui_ready(app: AppHandle, target_mode: String) -> Result<(), String> {
    let state = app.state::<Mutex<WindowModeState>>();
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    if target_mode == "taskbar" {
        let was_dashboard = state
            .lock()
            .map(|g| g.current_mode == "dashboard")
            .unwrap_or(false);
        if was_dashboard {
            capture_dashboard_position(&win, &state);
        }
        if let Ok(mut guard) = state.lock() {
            guard.current_mode = "taskbar".to_string();
        }
        shrink_to_taskbar(&app)?;
    } else if target_mode == "dashboard" {
        let was_taskbar = state
            .lock()
            .map(|g| g.current_mode == "taskbar")
            .unwrap_or(false);
        if let Ok(mut guard) = state.lock() {
            guard.current_mode = "dashboard".to_string();
        }
        if !was_taskbar {
            if let (Ok(size), Ok(scale)) = (win.outer_size(), win.scale_factor()) {
                let lw = size.width as f64 / scale;
                let lh = size.height as f64 / scale;
                if (lw - DASHBOARD_WIDTH).abs() <= 10.0 && (lh - DASHBOARD_HEIGHT).abs() <= 10.0 {
                    capture_dashboard_position(&win, &state);
                    return Ok(());
                }
            }
        }
        restore_dashboard(&app)?;
    } else {
        return Err(format!("ui_ready: unknown mode '{}'", target_mode));
    }

    Ok(())
}

// ── Channel #5: System Notification ─────────────────────────────────────────
#[tauri::command]
async fn notify(app: AppHandle, title: Option<String>, body: Option<String>) -> Result<(), String> {
    let t = title
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "PosturePet".to_string());
    let b = body
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Notification test from the debug menu.".to_string());

    app.notification()
        .builder()
        .title(t)
        .body(b)
        .show()
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Channels #6 & #7: Save / Load Persistence (health & XP) ──────────────────
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SaveData {
    pub health: f64,
    pub xp: f64,
}

fn resolve_save_data_path(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let root = if cwd.ends_with("src-tauri") {
            cwd.parent().unwrap_or(&cwd).to_path_buf()
        } else {
            cwd
        };
        Ok(root.join("save-data.json"))
    } else {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        if !dir.exists() {
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        }
        Ok(dir.join("save-data.json"))
    }
}

#[tauri::command]
async fn load_save(app: AppHandle) -> Result<Option<SaveData>, String> {
    let path = resolve_save_data_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let Ok(raw) = fs::read_to_string(&path) else {
        return Ok(None);
    };
    let Ok(parsed) = serde_json::from_str::<SaveData>(&raw) else {
        return Ok(None);
    };
    if parsed.health.is_finite() && parsed.xp.is_finite() {
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn write_save(app: AppHandle, data: SaveData) -> Result<(), String> {
    if !data.health.is_finite() || !data.xp.is_finite() {
        return Err("Invalid save data: health and xp must be finite numbers.".to_string());
    }
    let path = resolve_save_data_path(&app)?;
    let json = serde_json::to_string_pretty(&SaveData {
        health: data.health,
        xp: data.xp,
    })
    .map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(WindowModeState::default()))
        .manage(Mutex::new(DetectorState::default()))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let state = app.state::<Mutex<WindowModeState>>();
            let is_hidden = state.lock().map(|g| g.hidden_to_tray).unwrap_or(false);
            if is_hidden {
                show_from_tray(app);
                return;
            }
            if let Some(win) = app.get_webview_window("main") {
                if win.is_minimized().unwrap_or(false) {
                    let _ = win.unminimize();
                }
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let is_toggle_hotkey =
                        shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyH)
                            || (cfg!(target_os = "macos")
                                && shortcut.matches(Modifiers::SUPER | Modifiers::ALT, Code::KeyH));
                    if event.state == ShortcutState::Pressed && is_toggle_hotkey {
                        toggle_tray_visibility(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            if let Some(win) = app.get_webview_window("main") {
                let state = app.state::<Mutex<WindowModeState>>();
                capture_dashboard_position(&win, &state);
            }

            spawn_posture_ws_loop(app.handle().clone());

            // Register CommandOrControl+Alt+H global shortcut (Ctrl+Alt+H, plus Cmd+Option+H on macOS)
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyH);
            let _ = app.global_shortcut().register(shortcut);
            #[cfg(target_os = "macos")]
            {
                let mac_shortcut =
                    Shortcut::new(Some(Modifiers::SUPER | Modifiers::ALT), Code::KeyH);
                let _ = app.global_shortcut().register(mac_shortcut);
            }

            // System tray with context menu
            let minimize_item =
                MenuItem::with_id(app, "minimize_to_tray", "Minimize to Tray", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Quit PosturePet", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&minimize_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .tooltip("PosturePet")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "minimize_to_tray" => {
                        request_taskbar_mode(app);
                    }
                    "quit" => {
                        cleanup_detector(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        let state = app.state::<Mutex<WindowModeState>>();
                        let is_hidden = state.lock().map(|g| g.hidden_to_tray).unwrap_or(false);
                        if is_hidden {
                            show_from_tray(app);
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_icon(icon.clone());
                }
                tray_builder = tray_builder.icon(icon);
            }
            let _ = tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            let state = app.state::<Mutex<WindowModeState>>();
            match event {
                WindowEvent::Moved(_) => {
                    let should_capture = state
                        .lock()
                        .map(|g| g.current_mode == "dashboard" && !g.hidden_to_tray)
                        .unwrap_or(false);
                    if should_capture {
                        if let Some(win) = app.get_webview_window("main") {
                            capture_dashboard_position(&win, &state);
                        }
                    }
                }
                WindowEvent::Resized(_) => {
                    if let Some(win) = app.get_webview_window("main") {
                        if win.is_minimized().unwrap_or(false) {
                            let _ = win.unminimize();
                            let _ = win.show();
                            let _ = win.set_focus();
                            let was_dashboard = state
                                .lock()
                                .map(|g| g.current_mode == "dashboard")
                                .unwrap_or(false);
                            if was_dashboard {
                                if let Ok(mut guard) = state.lock() {
                                    guard.current_mode = "taskbar".to_string();
                                }
                                request_taskbar_mode(app);
                            } else {
                                let _ = shrink_to_taskbar(app);
                            }
                        }
                    }
                }
                WindowEvent::Destroyed => {
                    cleanup_detector(app);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            ui_ready,
            calibrate_posture,
            set_capture,
            set_debug,
            notify,
            load_save,
            write_save,
            custom_pets_list,
            custom_pets_get,
            custom_pets_create,
            custom_pets_import_directory,
            custom_pets_import_fixture,
            custom_pets_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
