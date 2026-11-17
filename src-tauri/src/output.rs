//! Watches the system's default audio output so the app can react when
//! headphones disconnect or the output switches (macOS only; elsewhere the
//! watcher reports nothing and the app simply keeps playing).

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

    pub fn info(id: u32) -> OutputInfo {
        OutputInfo { name: name(id), kind: kind(id).into(), muted: muted(id) }
    }
}

/// The current default output, if it can be read.
pub fn current() -> Option<OutputInfo> {
    #[cfg(target_os = "macos")]
    {
        mac::default_output().map(mac::info)
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// Polls the default output once a second and calls `on_change` when it changes.
/// Polling two CoreAudio properties a second costs next to nothing.
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
            if id == prev_id && info == prev_info {
                continue;
            }
            // Only the mute switch moved: report that on its own.
            if id == prev_id {
                if let (Some(p), Some(n)) = (&prev_info, &info) {
                    if p.name == n.name && p.kind == n.kind && p.muted != n.muted {
                        on_change(OutputChange {
                            change: if n.muted { "muted".into() } else { "unmuted".into() },
                            previous: prev_info.clone(),
                            current: info.clone(),
                        });
                        prev_info = info;
                        continue;
                    }
                }
            }
            let removed = match (prev_id, id) {
                (Some(p), Some(n)) if p != n => !mac::devices().contains(&p),
                (Some(_), None) => true,
                // Same device, but headphones unplugged from the jack.
                (Some(p), Some(n)) if p == n => {
                    prev_info.as_ref().map(|i| i.kind == "headphones").unwrap_or(false)
                        && info.as_ref().map(|i| i.kind != "headphones").unwrap_or(true)
                }
                _ => false,
            };
            on_change(OutputChange {
                change: if removed { "removed".into() } else { "switched".into() },
                previous: prev_info.clone(),
                current: info.clone(),
            });
            prev_id = id;
            prev_info = info;
        }
    });
    #[cfg(not(target_os = "macos"))]
    let _ = on_change;
}
