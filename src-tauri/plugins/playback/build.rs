// The commands the web side may call. They run in the Android plugin
// (android/src/main/java/space/tonewell/playback/PlaybackPlugin.kt).
const COMMANDS: &[&str] = &["update", "output", "keep_screen_on", "handle_back", "register_listener", "remove_listener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
