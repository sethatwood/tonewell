//! Tonewell on a phone. The sound is made in the webview, as on a computer;
//! this plugin keeps it going with the screen locked (a media-playback
//! foreground service), puts the session's controls on the lock screen and
//! headphone buttons, softens for calls, and reports headphones coming and
//! going. The work is in the Android plugin; the web side calls it directly
//! (`plugin:playback|update`) and listens for its `action`, `output` and
//! `focus` events.

use tauri::Runtime;
use tauri::plugin::{Builder, TauriPlugin};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("playback")
        .setup(|_app, api| {
            #[cfg(target_os = "android")]
            api.register_android_plugin("space.tonewell.playback", "PlaybackPlugin")?;
            #[cfg(not(target_os = "android"))]
            let _ = api;
            Ok(())
        })
        .build()
}
