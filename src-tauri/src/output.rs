//! Watches the system's default audio output so the app can react when
//! headphones disconnect or the output switches: CoreAudio on macOS, the
//! Windows Core Audio API on Windows. Elsewhere the watcher reports nothing
//! and the app simply keeps playing. Microphone use is only watched on macOS.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OutputInfo {
    pub name: String,
    /// "headphones", "speakers" or "unknown": a best guess from the transport.
    pub kind: String,
    /// The system's mute switch for this output.
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputChange {
    /// "removed" when the previous output disappeared, "muted" or "unmuted"
    /// when only the mute switch changed, "switched" otherwise.
    pub change: String,
    pub previous: Option<OutputInfo>,
    pub current: Option<OutputInfo>,
}

#[cfg(target_os = "macos")]
mod mac {
    use super::OutputInfo;
    use std::ffi::c_void;
    use std::os::raw::c_char;

    #[repr(C)]
    struct Address {
        selector: u32,
        scope: u32,
        element: u32,
    }

    const fn fourcc(s: &[u8; 4]) -> u32 {
        ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | (s[3] as u32)
    }

    const SYSTEM_OBJECT: u32 = 1;
    const DEFAULT_OUTPUT: u32 = fourcc(b"dOut");
    const DEVICES: u32 = fourcc(b"dev#");
    const NAME: u32 = fourcc(b"lnam");
    const TRANSPORT: u32 = fourcc(b"tran");
    const DATA_SOURCE: u32 = fourcc(b"ssrc");
    const MUTE: u32 = fourcc(b"mute");
    const RUNNING_SOMEWHERE: u32 = fourcc(b"gone");
    const STREAMS: u32 = fourcc(b"stm#");
    const SCOPE_INPUT: u32 = fourcc(b"inpt");
    const SCOPE_GLOBAL: u32 = fourcc(b"glob");
    const SCOPE_OUTPUT: u32 = fourcc(b"outp");
    const UTF8: u32 = 0x0800_0100;

    #[link(name = "CoreAudio", kind = "framework")]
    unsafe extern "C" {
        fn AudioObjectGetPropertyData(
            id: u32,
            address: *const Address,
            qualifier_size: u32,
            qualifier: *const c_void,
            data_size: *mut u32,
            data: *mut c_void,
        ) -> i32;
        fn AudioObjectGetPropertyDataSize(
            id: u32,
            address: *const Address,
            qualifier_size: u32,
            qualifier: *const c_void,
            data_size: *mut u32,
        ) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringGetCString(s: *const c_void, buf: *mut c_char, size: isize, encoding: u32) -> u8;
        fn CFRelease(cf: *const c_void);
    }

    fn get_u32(id: u32, selector: u32, scope: u32) -> Option<u32> {
        get_u32_at(id, selector, scope, 0)
    }

    fn get_u32_at(id: u32, selector: u32, scope: u32, element: u32) -> Option<u32> {
        let addr = Address { selector, scope, element };
        let mut value: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            AudioObjectGetPropertyData(id, &addr, 0, std::ptr::null(), &mut size, &mut value as *mut u32 as *mut c_void)
        };
        (status == 0).then_some(value)
    }

    pub fn default_output() -> Option<u32> {
        get_u32(SYSTEM_OBJECT, DEFAULT_OUTPUT, SCOPE_GLOBAL).filter(|id| *id != 0)
    }

    pub fn devices() -> Vec<u32> {
        let addr = Address { selector: DEVICES, scope: SCOPE_GLOBAL, element: 0 };
        let mut size: u32 = 0;
        if unsafe { AudioObjectGetPropertyDataSize(SYSTEM_OBJECT, &addr, 0, std::ptr::null(), &mut size) } != 0 {
            return Vec::new();
        }
        let count = size as usize / std::mem::size_of::<u32>();
        let mut ids = vec![0u32; count];
        let status = unsafe {
            AudioObjectGetPropertyData(SYSTEM_OBJECT, &addr, 0, std::ptr::null(), &mut size, ids.as_mut_ptr() as *mut c_void)
        };
        if status != 0 {
            return Vec::new();
        }
        ids.truncate(size as usize / std::mem::size_of::<u32>());
        ids
    }

    fn name(id: u32) -> String {
        let addr = Address { selector: NAME, scope: SCOPE_GLOBAL, element: 0 };
        let mut cf: *const c_void = std::ptr::null();
        let mut size = std::mem::size_of::<*const c_void>() as u32;
        let status = unsafe {
            AudioObjectGetPropertyData(id, &addr, 0, std::ptr::null(), &mut size, &mut cf as *mut *const c_void as *mut c_void)
        };
        if status != 0 || cf.is_null() {
            return "Unknown output".into();
        }
        let mut buf = [0 as c_char; 256];
        let ok = unsafe { CFStringGetCString(cf, buf.as_mut_ptr(), buf.len() as isize, UTF8) };
        unsafe { CFRelease(cf) };
        if ok == 0 {
            return "Unknown output".into();
        }
        unsafe { std::ffi::CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().into_owned()
    }

    fn kind(id: u32) -> &'static str {
        match get_u32(id, TRANSPORT, SCOPE_GLOBAL) {
            Some(t) if t == fourcc(b"blue") || t == fourcc(b"blea") => "headphones",
            Some(t) if t == fourcc(b"bltn") => match get_u32(id, DATA_SOURCE, SCOPE_OUTPUT) {
                Some(s) if s == fourcc(b"hdpn") => "headphones",
                Some(s) if s == fourcc(b"ispk") => "speakers",
                _ => "unknown",
            },
            Some(t) if t == fourcc(b"hdmi") || t == fourcc(b"dprt") || t == fourcc(b"airp") => "speakers",
            _ => "unknown",
        }
    }

    /// Muted on the main element, or on the first channel for devices that mute per channel.
    fn muted(id: u32) -> bool {
        get_u32_at(id, MUTE, SCOPE_OUTPUT, 0)
            .or_else(|| get_u32_at(id, MUTE, SCOPE_OUTPUT, 1))
            .map(|m| m != 0)
            .unwrap_or(false)
    }

    fn has_input(id: u32) -> bool {
        let addr = Address { selector: STREAMS, scope: SCOPE_INPUT, element: 0 };
        let mut size: u32 = 0;
        let status = unsafe { AudioObjectGetPropertyDataSize(id, &addr, 0, std::ptr::null(), &mut size) };
        status == 0 && size > 0
    }

    const PROCESS_LIST: u32 = fourcc(b"prs#");
    const PROCESS_RUNNING_INPUT: u32 = fourcc(b"piri");

    fn process_objects() -> Option<Vec<u32>> {
        let addr = Address { selector: PROCESS_LIST, scope: SCOPE_GLOBAL, element: 0 };
        let mut size: u32 = 0;
        if unsafe { AudioObjectGetPropertyDataSize(SYSTEM_OBJECT, &addr, 0, std::ptr::null(), &mut size) } != 0 {
            return None;
        }
        let mut ids = vec![0u32; size as usize / std::mem::size_of::<u32>()];
        let status = unsafe {
            AudioObjectGetPropertyData(SYSTEM_OBJECT, &addr, 0, std::ptr::null(), &mut size, ids.as_mut_ptr() as *mut c_void)
        };
        (status == 0).then_some(ids)
    }

    /// True when any app is recording from a microphone: the usual sign of a call.
    /// On macOS 14.2 and later this asks per process; earlier, it checks input
    /// devices, skipping the output device Tonewell itself is playing through.
    pub fn mic_in_use() -> bool {
        if let Some(procs) = process_objects() {
            return procs
                .into_iter()
                .any(|p| get_u32(p, PROCESS_RUNNING_INPUT, SCOPE_GLOBAL).map(|v| v != 0).unwrap_or(false));
        }
        let out = default_output();
        devices().into_iter().any(|id| {
            Some(id) != out && has_input(id) && get_u32(id, RUNNING_SOMEWHERE, SCOPE_GLOBAL).map(|v| v != 0).unwrap_or(false)
        })
    }

    pub fn info(id: u32) -> OutputInfo {
        OutputInfo { name: name(id), kind: kind(id).into(), muted: muted(id) }
    }
}

#[cfg(windows)]
mod win {
    use super::OutputInfo;
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        DEVICE_STATE_ACTIVE, DigitalAudioDisplayDevice, Headphones, Headset, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
        PKEY_AudioEndpoint_FormFactor, Speakers, eConsole, eRender,
    };
    use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PropVariantClear};
    use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree, STGM_READ};
    use windows::Win32::System::Variant::{VT_LPWSTR, VT_UI4};

    /// The device enumerator, after joining COM on this thread. Joining fails
    /// harmlessly on a thread that already joined in another mode.
    pub fn enumerator() -> Option<IMMDeviceEnumerator> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()
        }
    }

    fn id_of(device: &IMMDevice) -> Option<String> {
        unsafe {
            let raw = device.GetId().ok()?;
            let id = raw.to_string().ok();
            CoTaskMemFree(Some(raw.0 as *const _));
            id
        }
    }

    /// The default output for ordinary sound, with its id.
    pub fn default_output(e: &IMMDeviceEnumerator) -> Option<(String, IMMDevice)> {
        unsafe {
            let device = e.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
            Some((id_of(&device)?, device))
        }
    }

    /// Every output that is plugged in and enabled.
    pub fn devices(e: &IMMDeviceEnumerator) -> Vec<String> {
        unsafe {
            let Ok(list) = e.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else { return Vec::new() };
            let count = list.GetCount().unwrap_or(0);
            (0..count).filter_map(|i| list.Item(i).ok()).filter_map(|d| id_of(&d)).collect()
        }
    }

    /// Read one property, handing the value to `read` before it is freed.
    fn property<T>(device: &IMMDevice, key: &PROPERTYKEY, read: impl FnOnce(&PROPVARIANT) -> Option<T>) -> Option<T> {
        unsafe {
            let mut value = device.OpenPropertyStore(STGM_READ).ok()?.GetValue(key).ok()?;
            let out = read(&value);
            let _ = PropVariantClear(&mut value);
            out
        }
    }

    pub fn info(device: &IMMDevice) -> OutputInfo {
        let name = property(device, &PKEY_Device_FriendlyName, |v| unsafe {
            let inner = &v.Anonymous.Anonymous;
            if inner.vt == VT_LPWSTR { inner.Anonymous.pwszVal.to_string().ok() } else { None }
        });
        let form = property(device, &PKEY_AudioEndpoint_FormFactor, |v| unsafe {
            let inner = &v.Anonymous.Anonymous;
            if inner.vt == VT_UI4 { Some(inner.Anonymous.ulVal as i32) } else { None }
        });
        let kind = match form {
            Some(f) if f == Headphones.0 || f == Headset.0 => "headphones",
            Some(f) if f == Speakers.0 || f == DigitalAudioDisplayDevice.0 => "speakers",
            _ => "unknown",
        };
        let muted = unsafe {
            device
                .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
                .ok()
                .and_then(|volume| volume.GetMute().ok())
                .is_some_and(|m| m.as_bool())
        };
        OutputInfo { name: name.unwrap_or_else(|| "Output".into()), kind: kind.into(), muted }
    }
}

/// What changed between two looks at the default output, if anything.
/// `still_there` says whether the previous device is still plugged in.
fn compare<Id: PartialEq>(
    prev: (&Option<Id>, &Option<OutputInfo>),
    now: (&Option<Id>, &Option<OutputInfo>),
    still_there: impl Fn(&Id) -> bool,
) -> Option<OutputChange> {
    let ((prev_id, prev_info), (id, info)) = (prev, now);
    if id == prev_id && info == prev_info {
        return None;
    }
    // Only the mute switch moved: report that on its own.
    if id == prev_id {
        if let (Some(p), Some(n)) = (prev_info, info) {
            if p.name == n.name && p.kind == n.kind && p.muted != n.muted {
                return Some(OutputChange {
                    change: if n.muted { "muted".into() } else { "unmuted".into() },
                    previous: prev_info.clone(),
                    current: info.clone(),
                });
            }
        }
    }
    let removed = match (prev_id, id) {
        (Some(p), Some(n)) if p != n => !still_there(p),
        (Some(_), None) => true,
        // Same device, but headphones unplugged from its jack.
        (Some(_), Some(_)) => {
            prev_info.as_ref().is_some_and(|i| i.kind == "headphones") && info.as_ref().is_none_or(|i| i.kind != "headphones")
        }
        _ => false,
    };
    Some(OutputChange {
        change: if removed { "removed".into() } else { "switched".into() },
        previous: prev_info.clone(),
        current: info.clone(),
    })
}

/// Whether any app is recording from a microphone right now.
pub fn mic_in_use() -> bool {
    #[cfg(target_os = "macos")]
    {
        mac::mic_in_use()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// The current default output, if it can be read.
pub fn current() -> Option<OutputInfo> {
    #[cfg(target_os = "macos")]
    {
        mac::default_output().map(mac::info)
    }
    #[cfg(windows)]
    {
        win::enumerator().and_then(|e| win::default_output(&e)).map(|(_, d)| win::info(&d))
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        None
    }
}

/// Polls every two seconds for any microphone in use and calls `on_change(true/false)` when that changes.
pub fn watch_mic<F: Fn(bool) + Send + 'static>(on_change: F) {
    #[cfg(target_os = "macos")]
    std::thread::spawn(move || {
        let mut prev = mac::mic_in_use();
        on_change(prev);
        loop {
            std::thread::sleep(std::time::Duration::from_millis(2000));
            let now = mac::mic_in_use();
            if now != prev {
                on_change(now);
                prev = now;
            }
        }
    });
    #[cfg(not(target_os = "macos"))]
    let _ = on_change;
}

/// Polls the default output and calls `on_change` when it changes: once a
/// second on macOS (two CoreAudio properties cost next to nothing), four
/// times a second on Windows, where pulling headphones out moves the sound
/// to the speakers at once, so the pause must come quickly.
pub fn watch<F: Fn(OutputChange) + Send + 'static>(on_change: F) {
    #[cfg(target_os = "macos")]
    std::thread::spawn(move || {
        let mut prev_id = mac::default_output();
        let mut prev_info = prev_id.map(mac::info);
        // Data sources (the headphone jack on built-in output) can change without the device id changing.
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            let id = mac::default_output();
            let info = id.map(mac::info);
            if let Some(change) = compare((&prev_id, &prev_info), (&id, &info), |p| mac::devices().contains(p)) {
                on_change(change);
            }
            prev_id = id;
            prev_info = info;
        }
    });
    #[cfg(windows)]
    std::thread::spawn(move || {
        let Some(e) = win::enumerator() else { return };
        let look = || match win::default_output(&e) {
            Some((id, device)) => (Some(id), Some(win::info(&device))),
            None => (None, None),
        };
        let (mut prev_id, mut prev_info) = look();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let (id, info) = look();
            if let Some(change) = compare((&prev_id, &prev_info), (&id, &info), |p| win::devices(&e).contains(p)) {
                on_change(change);
            }
            prev_id = id;
            prev_info = info;
        }
    });
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = on_change;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out(name: &str, kind: &str, muted: bool) -> Option<OutputInfo> {
        Some(OutputInfo { name: name.into(), kind: kind.into(), muted })
    }

    fn change(prev: (Option<u32>, Option<OutputInfo>), now: (Option<u32>, Option<OutputInfo>), present: &[u32]) -> Option<String> {
        compare((&prev.0, &prev.1), (&now.0, &now.1), |id| present.contains(id)).map(|c| c.change)
    }

    #[test]
    fn nothing_changed() {
        let a = (Some(1), out("AirPods", "headphones", false));
        assert_eq!(change(a.clone(), a, &[1]), None);
    }

    #[test]
    fn headphones_taken_away_is_removed() {
        let before = (Some(1), out("AirPods", "headphones", false));
        let after = (Some(2), out("MacBook Speakers", "speakers", false));
        assert_eq!(change(before, after, &[2]).as_deref(), Some("removed"));
    }

    #[test]
    fn choosing_another_output_is_a_switch() {
        let before = (Some(1), out("AirPods", "headphones", false));
        let after = (Some(2), out("MacBook Speakers", "speakers", false));
        assert_eq!(change(before, after, &[1, 2]).as_deref(), Some("switched"));
    }

    #[test]
    fn unplugging_from_the_jack_is_removed() {
        let before = (Some(1), out("Built-in Output", "headphones", false));
        let after = (Some(1), out("Built-in Output", "speakers", false));
        assert_eq!(change(before, after, &[1]).as_deref(), Some("removed"));
    }

    #[test]
    fn no_output_left_is_removed() {
        assert_eq!(change((Some(1), out("USB DAC", "unknown", false)), (None, None), &[]).as_deref(), Some("removed"));
    }

    #[test]
    fn the_mute_switch_alone() {
        let on = (Some(1), out("AirPods", "headphones", false));
        let off = (Some(1), out("AirPods", "headphones", true));
        assert_eq!(change(on.clone(), off.clone(), &[1]).as_deref(), Some("muted"));
        assert_eq!(change(off, on, &[1]).as_deref(), Some("unmuted"));
    }
}
