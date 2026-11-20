//! Updates. The page decides when to look (once a day, if the person allows
//! it, or when they ask); this module asks tonewell.space whether there is a
//! newer version, downloads it quietly and keeps it until it can install
//! without interrupting anything: when the app quits, or when the person
//! chooses to restart from the player while nothing is playing.
//!
//! The check carries nothing about the person: a fixed URL and the updater's
//! own user agent. Every download is checked against the public key in
//! tauri.conf.json, and its signature must name the version it claims to be.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// What the page shows about updates. Sent with every change as `update-status`.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The version running now.
    pub current: String,
    /// idle | checking | downloading | ready | latest | failed
    pub state: &'static str,
    /// The newer version, once one is found.
    pub version: Option<String>,
    /// When the last check finished, in milliseconds since 1970.
    pub checked_at: Option<u64>,
    pub error: Option<String>,
    /// Whether a downloaded update can install by itself at quit.
    pub installs_at_quit: bool,
}

/// A downloaded update. The package waits on disk rather than in memory: an
/// AppImage is near 100 MB, and the app may run for weeks before it quits.
struct Ready {
    update: Update,
    file: PathBuf,
}

#[derive(Default)]
pub struct Updates {
    status: Mutex<Status>,
    /// The downloaded update. Held while it installs, so a second install
    /// (or a quit) waits for the first instead of exiting halfway through.
    ready: Mutex<Option<Ready>>,
    /// Only one check at a time.
    checking: tauri::async_runtime::Mutex<()>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn set_status(app: &AppHandle, f: impl FnOnce(&mut Status)) -> Status {
    let updates = app.state::<Updates>();
    let mut status = updates.status.lock().unwrap();
    status.current = app.package_info().version.to_string();
    status.installs_at_quit = silent_install_possible(app);
    if status.state.is_empty() {
        status.state = "idle";
    }
    f(&mut status);
    let out = status.clone();
    drop(status);
    let _ = app.emit("update-status", &out);
    out
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> Status {
    set_status(&app, |_| {})
}

/// Look for a newer version and, if there is one, download it. Returns once
/// the update is ready to install, or there is none, or the check failed.
#[tauri::command]
pub async fn update_check(app: AppHandle, state: State<'_, Updates>) -> Result<Status, String> {
    let _one = state.checking.lock().await;
    // Already downloaded (perhaps an install failed): offer it again.
    if state.ready.lock().unwrap().is_some() {
        return Ok(set_status(&app, |s| {
            s.state = "ready";
            s.error = None;
            s.checked_at = Some(now_ms());
        }));
    }
    set_status(&app, |s| {
        s.state = "checking";
        s.error = None;
    });
    let failed = |app: &AppHandle, err: String| {
        log::warn!("update check failed: {err}");
        set_status(app, |s| {
            s.state = "failed";
            s.checked_at = Some(now_ms());
            s.error = Some(err);
        })
    };
    let handle = app.clone();
    let builder = app.updater_builder().timeout(Duration::from_secs(60)).on_before_exit(move || {
        // Windows: the installer is about to replace this process. This
        // replaces the plugin's own hook, so do its cleanup (the tray icon)
        // as well as saving where the player was.
        use tauri_plugin_window_state::{AppHandleExt, StateFlags};
        let _ = handle.save_window_state(StateFlags::POSITION);
        handle.cleanup_before_exit();
    });
    let found = match builder.build() {
        Ok(updater) => updater.check().await,
        Err(err) => return Ok(failed(&app, err.to_string())),
    };
    let mut update = match found {
        Ok(Some(update)) => update,
        Ok(None) => {
            return Ok(set_status(&app, |s| {
                s.state = "latest";
                s.version = None;
                s.checked_at = Some(now_ms());
            }));
        }
        Err(err) => return Ok(failed(&app, err.to_string())),
    };
    let version = update.version.clone();
    set_status(&app, |s| {
        s.state = "downloading";
        s.version = Some(version.clone());
    });
    // A stalled download must not hold the check forever.
    update.timeout = Some(Duration::from_secs(15 * 60));
    // `download` checks the signature before it returns the bytes.
    let bytes = match update.download(|_, _| {}, || {}).await {
        Ok(bytes) => bytes,
        Err(err) => return Ok(failed(&app, err.to_string())),
    };
    let file = match keep(&app, &version, &bytes) {
        Ok(file) => file,
        Err(err) => return Ok(failed(&app, format!("couldn't keep the download: {err}"))),
    };
    *state.ready.lock().unwrap() = Some(Ready { update, file });
    Ok(set_status(&app, |s| {
        s.state = "ready";
        s.checked_at = Some(now_ms());
    }))
}

/// Write the downloaded package to the app's cache folder, replacing any older one.
fn keep(app: &AppHandle, version: &str, bytes: &[u8]) -> std::io::Result<PathBuf> {
    let dir = app.path().app_cache_dir().map_err(std::io::Error::other)?.join("update");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir)?;
    let file = dir.join(format!("tonewell-{version}.package"));
    std::fs::write(&file, bytes)?;
    Ok(file)
}

fn forget(file: &Path) {
    if let Some(dir) = file.parent() {
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// Install the downloaded update and start the new version. The page only
/// offers this while nothing is playing, and holds off sessions meanwhile.
#[tauri::command]
pub async fn update_restart(app: AppHandle) -> Result<(), String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || install(&handle, true))
        .await
        .map_err(|e| e.to_string())??;
    crate::desktop::QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    app.restart();
}

/// Drop a downloaded update: the person turned updates off.
#[tauri::command]
pub fn update_discard(app: AppHandle, state: State<Updates>) -> Status {
    if let Some(ready) = state.ready.lock().unwrap().take() {
        forget(&ready.file);
    }
    set_status(&app, |s| {
        s.state = "idle";
        s.version = None;
        s.error = None;
    })
}

/// Install the downloaded update, if any. With `restart`, the Windows
/// installer starts the new version when it's done; on macOS and Linux the
/// caller restarts.
fn install(app: &AppHandle, restart: bool) -> Result<(), String> {
    let updates = app.state::<Updates>();
    let mut ready = updates.ready.lock().unwrap();
    let Some(Ready { update, file }) = ready.take() else {
        return Err("No update has been downloaded.".into());
    };
    let update = update.restart_after_install(restart);
    // `install` checks the signature again, so a damaged file never installs.
    let result = std::fs::read(&file)
        .map_err(|e| e.to_string())
        .and_then(|bytes| update.install(&bytes).map_err(|e| e.to_string()));
    match &result {
        Ok(()) => forget(&file),
        Err(err) => {
            log::warn!("update install failed: {err}");
            // Keep it: the next check offers it again.
            *ready = Some(Ready { update, file });
            drop(ready);
            set_status(app, |s| {
                s.state = "failed";
                s.error = Some(err.clone());
            });
        }
    }
    result
}

/// On the way out: install a downloaded update if that can happen silently,
/// so the next launch is the new version. Never asks for a password, and waits
/// for an install that is already under way.
pub fn install_at_quit(app: &AppHandle) {
    let Some(updates) = app.try_state::<Updates>() else { return };
    if updates.ready.lock().unwrap().is_none() || !silent_install_possible(app) {
        return;
    }
    let _ = install(app, false);
}

/// Whether installing needs no password or prompt. On macOS the app and its
/// folder must be writable; on Linux it must be an AppImage in a writable
/// folder (a .deb or .rpm asks for a password); on Windows it must be the
/// per-user installer (an .msi installs for all users and needs an admin).
fn silent_install_possible(app: &AppHandle) -> bool {
    match bundle_type() {
        Some(BundleType::Nsis) => true,
        Some(BundleType::App) => macos_bundle().is_some_and(|bundle| writable(&bundle) && bundle.parent().is_some_and(writable)),
        Some(BundleType::AppImage) => appimage(app).as_deref().and_then(Path::parent).is_some_and(writable),
        _ => false,
    }
}

/// Whether this process can create (and remove) an entry in `dir`.
fn writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".tonewell-update-{}", std::process::id()));
    let ok = std::fs::create_dir(&probe).is_ok();
    let _ = std::fs::remove_dir(&probe);
    ok
}

/// …/Tonewell.app, from …/Tonewell.app/Contents/MacOS/tonewell.
fn macos_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bundle = exe.ancestors().nth(3)?;
    (bundle.extension()? == "app").then(|| bundle.to_path_buf())
}

#[cfg(target_os = "linux")]
fn appimage(app: &AppHandle) -> Option<PathBuf> {
    app.env().appimage.map(PathBuf::from)
}

#[cfg(not(target_os = "linux"))]
fn appimage(_app: &AppHandle) -> Option<PathBuf> {
    None
}
