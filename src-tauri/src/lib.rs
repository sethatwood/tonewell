//! Tonewell's native shell. On a computer it is the menu-bar item, keep-awake,
//! output-device watching, window lifecycle, updates, and a quit that lets
//! the sound fade first (see desktop.rs). On a phone, the playback plugin
//! keeps the sound going with the screen locked and puts its controls on the
//! lock screen.
//! All sound is made in the main window's webview; see src/audio.

#[cfg(desktop)]
mod desktop;
mod media;
mod output;
#[cfg(desktop)]
mod updates;

use tauri::AppHandle;

/// Tell macOS whether a session is playing, for media keys and headphone buttons.
#[tauri::command]
fn media_state(app: AppHandle, state: String, title: String) {
    media::set_state(&app, state, title);
}

#[tauri::command]
fn mic_in_use() -> bool {
    output::mic_in_use()
}

#[tauri::command]
fn audio_output() -> Option<output::OutputInfo> {
    output::current()
}

/// Diagnostics for automated checks: TONEWELL_AUTOSTART=1 starts a session at launch,
/// TONEWELL_HIDE=1 hides the window once it has started, TONEWELL_PRESET picks a preset,
/// TONEWELL_LOG=1 prints the scheduler's health every ten seconds, TONEWELL_MINUTES sets the
/// session length. TONEWELL_OPEN runs steps in order: open a window or mode (visuals, learn,
/// settings, mini, full), open a sheet under the player (sheet-sound, sheet-session,
/// sheet-beat, sheet-custom, sheet-shape, sheet-all, sheet-guide, sheet-name) or close it
/// (sheet-close), wait two seconds (pause), check for and download an update
/// (update-check), install it and restart (update-restart), or quit as ⌘Q does (quit).
///
/// A phone app gets no environment, so there the same flags are read from
/// `debug-flags.json` in the app's data folder, which only a debuggable build lets
/// anyone write (`adb shell run-as`), e.g. `{"TONEWELL_LOG": "1"}`.
#[tauri::command]
fn debug_flags(app: AppHandle) -> serde_json::Value {
    let file = flag_file(&app);
    let get = |k: &str| std::env::var(k).ok().or_else(|| file.get(k).and_then(|v| v.as_str()).map(String::from));
    let on = |k: &str| get(k).is_some_and(|v| v == "1");
    serde_json::json!({
        "autostart": on("TONEWELL_AUTOSTART"),
        "hide": on("TONEWELL_HIDE"),
        "log": on("TONEWELL_LOG"),
        "preset": get("TONEWELL_PRESET"),
        "open": get("TONEWELL_OPEN"),
        "minutes": get("TONEWELL_MINUTES").and_then(|m| m.parse::<f64>().ok()),
    })
}

#[cfg(mobile)]
fn flag_file(app: &AppHandle) -> serde_json::Map<String, serde_json::Value> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("debug-flags.json")).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

#[cfg(desktop)]
fn flag_file(_app: &AppHandle) -> serde_json::Map<String, serde_json::Value> {
    serde_json::Map::new()
}

#[tauri::command]
fn debug_log(line: String) {
    #[cfg(target_os = "android")]
    android_log(&line);
    #[cfg(not(target_os = "android"))]
    eprintln!("[tonewell] {line}");
}

/// Android has no stderr to read: write to the system log (`adb logcat -s tonewell`).
#[cfg(target_os = "android")]
fn android_log(line: &str) {
    use std::ffi::{CString, c_char};
    #[link(name = "log")]
    unsafe extern "C" {
        fn __android_log_write(prio: i32, tag: *const c_char, text: *const c_char) -> i32;
    }
    const INFO: i32 = 4;
    if let Ok(text) = CString::new(line.replace('\0', " ")) {
        unsafe { __android_log_write(INFO, c"tonewell".as_ptr(), text.as_ptr()) };
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    desktop::run(tauri::generate_context!());

    #[cfg(mobile)]
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_playback::init())
        .invoke_handler(tauri::generate_handler![media_state, mic_in_use, audio_output, debug_flags, debug_log])
        .run(tauri::generate_context!())
        .expect("error while running Tonewell");
}
