//! Media keys and headphone buttons. While a session runs, Tonewell tells
//! macOS it is the "now playing" app, so the keyboard's play/pause key or a
//! press on AirPods walks the same ladder as Esc: start, wind down, end.
//! When no session runs it steps back, so those keys go to other apps again.

use tauri::AppHandle;

#[cfg(target_os = "macos")]
mod mac {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSDictionary, NSString};
    use objc2_media_player::{
        MPMediaItemPropertyArtist, MPMediaItemPropertyTitle, MPNowPlayingInfoCenter, MPNowPlayingPlaybackState,
        MPRemoteCommandCenter, MPRemoteCommandEvent, MPRemoteCommandHandlerStatus,
    };
    use std::ptr::NonNull;
    use tauri::{AppHandle, Emitter};

    /// Must run on the main thread.
    pub fn install(app: &AppHandle) {
        unsafe {
            let center = MPRemoteCommandCenter::sharedCommandCenter();
            let make = |action: &'static str| {
                let app = app.clone();
                RcBlock::new(move |_event: NonNull<MPRemoteCommandEvent>| {
                    let _ = app.emit_to("main", "tray-action", action.to_string());
                    MPRemoteCommandHandlerStatus::Success
                })
            };
            center.togglePlayPauseCommand().addTargetWithHandler(&make("media-toggle"));
            center.playCommand().addTargetWithHandler(&make("media-play"));
            center.pauseCommand().addTargetWithHandler(&make("media-pause"));
            center.stopCommand().addTargetWithHandler(&make("end"));
            center.nextTrackCommand().addTargetWithHandler(&make("next-preset"));
        }
    }

    /// Must run on the main thread.
    pub fn set_state(state: &str, title: &str) {
        unsafe {
            let info = MPNowPlayingInfoCenter::defaultCenter();
            if state == "stopped" {
                info.setNowPlayingInfo(None);
                info.setPlaybackState(MPNowPlayingPlaybackState::Stopped);
                return;
            }
            let title = NSString::from_str(title);
            let artist = NSString::from_str("Tonewell");
            let values: [Retained<AnyObject>; 2] = [Retained::into_super(Retained::into_super(title)), Retained::into_super(Retained::into_super(artist))];
            let keys: [&NSString; 2] = [MPMediaItemPropertyTitle, MPMediaItemPropertyArtist];
            let dict = NSDictionary::from_retained_objects(&keys, &values);
            info.setNowPlayingInfo(Some(&dict));
            info.setPlaybackState(if state == "playing" {
                MPNowPlayingPlaybackState::Playing
            } else {
                MPNowPlayingPlaybackState::Paused
            });
        }
    }
}

pub fn install(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    mac::install(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// `state` is "playing", "paused" (winding down or resting) or "stopped".
pub fn set_state(app: &AppHandle, state: String, title: String) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(move || mac::set_state(&state, &title));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, state, title);
}
