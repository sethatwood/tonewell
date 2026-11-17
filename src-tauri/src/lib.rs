//! Tonewell's native shell: the menu-bar item, keep-awake, output-device
//! watching, window lifecycle and a quit that lets the sound fade first.
//! All sound is made in the main window's webview; see src/audio.

mod media;
mod output;

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent, Wry};

const TRAY_ID: &str = "tonewell";

/// A menu described by the web side, so the menu bar always mirrors the player.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum MenuNode {
    Item {
        id: String,
        label: String,
        #[serde(default = "yes")]
        enabled: bool,
    },
    Check {
        id: String,
        label: String,
        checked: bool,
        #[serde(default = "yes")]
        enabled: bool,
    },
    Separator,
    Submenu {
        label: String,
        children: Vec<MenuNode>,
        #[serde(default = "yes")]
        enabled: bool,
    },
}

fn yes() -> bool {
    true
}

fn append_nodes(app: &AppHandle, nodes: &[MenuNode], push: &mut dyn FnMut(&dyn tauri::menu::IsMenuItem<Wry>) -> tauri::Result<()>) -> tauri::Result<()> {
    for node in nodes {
        match node {
            MenuNode::Item { id, label, enabled } => {
                push(&MenuItem::with_id(app, format!("tray:{id}"), label, *enabled, None::<&str>)?)?;
            }
            MenuNode::Check { id, label, checked, enabled } => {
                push(&CheckMenuItem::with_id(app, format!("tray:{id}"), label, *enabled, *checked, None::<&str>)?)?;
            }
            MenuNode::Separator => push(&PredefinedMenuItem::separator(app)?)?,
            MenuNode::Submenu { label, children, enabled } => {
                let sub = Submenu::new(app, label, *enabled)?;
                append_nodes(app, children, &mut |item| sub.append(item))?;
                push(&sub)?;
            }
        }
    }
    Ok(())
}

fn build_menu(app: &AppHandle, nodes: &[MenuNode]) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    append_nodes(app, nodes, &mut |item| menu.append(item))?;
    Ok(menu)
}

fn tray_image(state: &str) -> tauri::Result<Image<'static>> {
    let bytes: &[u8] = match state {
        "playing" => include_bytes!("../icons/tray/playing.png"),
        "resting" => include_bytes!("../icons/tray/resting.png"),
        _ => include_bytes!("../icons/tray/ready.png"),
    };
    Image::from_bytes(bytes)
}

fn tray(app: &AppHandle) -> Option<TrayIcon> {
    app.tray_by_id(TRAY_ID)
}

#[tauri::command]
fn tray_update(app: AppHandle, menu: Vec<MenuNode>, icon: String, title: Option<String>, tooltip: String) -> Result<(), String> {
    let tray = tray(&app).ok_or("no tray")?;
    let built = build_menu(&app, &menu).map_err(|e| e.to_string())?;
    tray.set_menu(Some(built)).map_err(|e| e.to_string())?;
    tray.set_icon_with_as_template(Some(tray_image(&icon).map_err(|e| e.to_string())?), true)
        .map_err(|e| e.to_string())?;
    tray.set_title(title.as_deref()).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Default)]
struct Awake(Mutex<Option<keepawake::KeepAwake>>);

/// Keep the Mac awake during a session. `display` also keeps the screen on.
#[tauri::command]
fn set_keep_awake(state: State<Awake>, display: bool, system: bool) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = None;
    if display || system {
        let awake = keepawake::Builder::default()
            .display(display)
            .idle(system)
            .reason("A Tonewell session is playing")
            .app_name("Tonewell")
            .app_reverse_domain("space.tonewell.app")
            .create()
            .map_err(|e| e.to_string())?;
        *guard = Some(awake);
    }
    Ok(())
}

/// Tell macOS whether a session is playing, for media keys and headphone buttons.
#[tauri::command]
fn media_state(app: AppHandle, state: String, title: String) {
    media::set_state(&app, state, title);
}

/// Resize the mini player keeping its top edge in place. On macOS this uses
/// the system's own frame animation, unless `animate` is false (Reduce motion).
#[tauri::command]
fn resize_player(window: tauri::WebviewWindow, height: f64, animate: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let ns = window.ns_window().map_err(|e| e.to_string())? as usize;
        window
            .run_on_main_thread(move || unsafe {
                use objc2_app_kit::NSWindow;
                let w: &NSWindow = &*(ns as *const NSWindow);
                let mut frame = w.frame();
                let top = frame.origin.y + frame.size.height;
                frame.size.height = height;
                frame.origin.y = top - height;
                w.setFrame_display_animate(frame, true, animate);
            })
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = animate;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        window
            .set_size(tauri::LogicalSize::new(size.width as f64 / scale, height))
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn audio_output() -> Option<output::OutputInfo> {
    output::current()
}

/// Diagnostics for automated checks: TONEWELL_AUTOSTART=1 starts a session at launch,
/// TONEWELL_HIDE=1 hides the window once it has started, TONEWELL_PRESET picks a preset,
/// TONEWELL_LOG=1 prints the scheduler's health every ten seconds, TONEWELL_OPEN opens
/// windows by name (expand, visuals, learn, settings).
#[tauri::command]
fn debug_flags() -> serde_json::Value {
    let on = |k: &str| std::env::var(k).map(|v| v == "1").unwrap_or(false);
    serde_json::json!({
        "autostart": on("TONEWELL_AUTOSTART"),
        "hide": on("TONEWELL_HIDE"),
        "log": on("TONEWELL_LOG"),
        "preset": std::env::var("TONEWELL_PRESET").ok(),
        "open": std::env::var("TONEWELL_OPEN").ok(),
    })
}

#[tauri::command]
fn debug_log(line: String) {
    eprintln!("[tonewell] {line}");
}

static QUITTING: AtomicBool = AtomicBool::new(false);

/// Called by the page once the sound has faded out.
#[tauri::command]
fn quit_now(app: AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Ask the page to fade out, and quit anyway if it doesn't answer in time.
fn request_quit(app: &AppHandle) {
    if app.emit_to("main", "quit-requested", ()).is_err() {
        QUITTING.store(true, Ordering::SeqCst);
        app.exit(0);
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(4000));
        QUITTING.store(true, Ordering::SeqCst);
        handle.exit(0);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .with_denylist(&["visuals", "learn", "settings"])
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_opener::init())
        .manage(Awake::default())
        .invoke_handler(tauri::generate_handler![tray_update, set_keep_awake, audio_output, media_state, resize_player, quit_now, debug_flags, debug_log])
        .setup(|app| {
            let handle = app.handle().clone();
            let start = build_menu(
                &handle,
                &[
                    MenuNode::Item { id: "show".into(), label: "Show mini player".into(), enabled: true },
                    MenuNode::Separator,
                    MenuNode::Item { id: "quit".into(), label: "Quit Tonewell".into(), enabled: true },
                ],
            )?;
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(tray_image("ready")?)
                .icon_as_template(true)
                .show_menu_on_left_click(true)
                .tooltip("Tonewell")
                .menu(&start)
                .on_menu_event(|app, event| {
                    let id = event.id().as_ref();
                    let Some(action) = id.strip_prefix("tray:") else { return };
                    match action {
                        "show" => show_main(app),
                        "quit" => request_quit(app),
                        _ => {
                            let _ = app.emit_to("main", "tray-action", action.to_string());
                        }
                    }
                })
                .build(app)?;

            media::install(&handle);

            let watcher = handle.clone();
            output::watch(move |change| {
                let _ = watcher.emit_to("main", "audio-output", change);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the mini player only hides it: the sound keeps playing from the menu bar.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && !QUITTING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Tonewell");

    app.run(|app, event| match event {
        RunEvent::ExitRequested { api, .. } => {
            if !QUITTING.load(Ordering::SeqCst) {
                api.prevent_exit();
                request_quit(app);
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(app),
        _ => {}
    });
}
