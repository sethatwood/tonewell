# Architecture decisions

Short records of the choices that shape Tonewell, newest at the bottom.
Each says what was decided, why, and what would make us revisit it.

## 1. Sound is made with Web Audio in the mini player's webview

**Decision.** The audio engine runs in the main window's webview (WKWebView
on macOS), behind an `AudioEngine` interface (`src/audio/engine.ts`). A
native engine (for example `cpal` with `fundsp`) could implement the same
interface later without touching the UI or the session logic.

**Why.** The original prototype's sound was proven in Web Audio, and a
webview engine is the fastest way to keep that character exactly. The risks
were timer throttling when the window is hidden and the webview's behavior
with no visible window. They are handled like this:

- The main window is created with `backgroundThrottling: "disabled"`
  (Tauri 2's switch for WKWebView's inactive scheduling policy). Closing
  the window only hides it, so the page and its audio keep running.
- Nothing musical is timed with `setTimeout`. See decision 2.
- A tiny AudioWorklet (`tw-clock`) posts the audio clock to the page
  several times a second, as a heartbeat that doesn't depend on page
  timers; a 250 ms interval is the fallback.

**Evidence so far.** In the built app, with the window hidden, the
scheduler ran about eight times a second with a longest gap of 0.15 s, and
the AudioWorklet loaded under the `tauri://` scheme. With the window
hidden, the WebKit content process used about 1% of one core for Brown
Noise Desk and about 4% for Deep Theta, the busiest Meditate preset.
Layers that are off disconnect themselves after their fade, so they cost
nothing; `npm run perf` reports each layer's cost.

Two longer runs in the built app, window hidden throughout:

- A 20-minute Deep Theta session ran its full course: timer end on the
  audio clock, wind down to the hum, a 2-minute rest, a 20-second fade,
  and back to ready with the audio context suspended.
- A 40-minute Deep Theta session with the display asleep did the same.
  The longest gap between scheduler runs was 0.17 s across 42 minutes,
  and CPU was flat (4.5% of one core in the first ten minutes, 4.7% in
  the last ten).

**Revisit if** a session with the screen locked (not just the display
asleep) glitches or drifts, or a multi-hour Focus session's CPU creeps.

## 2. Musical time lives on the audio clock

**Decision.** Continuous motion (filter sweeps, root glides, beat-frequency
ramps, fades, the timer's end fade) is written into AudioParam timelines.
Discrete events (bells, shimmer grains, root steps) are placed up to 8 s
ahead by a lookahead scheduler that reads `AudioContext.currentTime`.

**Why.** If the page stalls, the sound keeps its shape: sweeps keep
sweeping, ramps keep ramping and fades still finish. After a long stall the
scheduler skips the backlog instead of firing it all at once, so a stall
can thin the bells but never bunch them up. As a last safety net, a timed
session's final fade is also scheduled on the audio clock when the session
starts.

## 3. Every sound is generated

**Decision.** There are no recordings. The drone, beats, bells, breath and
the wordless voices (a small formant choir) are oscillators and filtered
noise; rain, ocean, wind, noise beds and the
Shepard rise are generated sample by sample in an AudioWorklet
(`src/audio/worklets/processors.js`). The reverb uses a generated
exponential-decay noise impulse, as in the prototype.

The breath layer loops a 9.7 s buffer of decorrelated pink noise under a
moving band-pass filter (with the loop seam cross-faded). That's the only
loop, and it's inaudible as one.

## 4. Safety is in the signal chain, not just the UI

**Decision.** Output goes through: session fade → timer fade → volume →
limiter (−4 dB, 20:1) → soft clipper (ceiling 0.94) → output.

- Session fades use S-curves; nothing starts or stops abruptly.
- Volume rises are capped at 12 dB per second and falls at 40 dB per
  second, however fast the slider moves.
- Wind down lowers the bed with its own gain stage after the glue
  compressor, which would otherwise level the drop out.
- When headphones disappear, the session mutes within 50 ms (the one
  deliberate fast change, because the alternative is sound from the
  speakers) and waits to be resumed.

`npm run test:audio` renders the real engine in WebKit and checks these
properties on every preset.

## 5. No UI framework

**Decision.** Vanilla TypeScript with small DOM helpers. One parameter
table (`src/audio/params.ts`) defines every control's range, default,
units, label and help text, and the panel is generated from it.

**Why.** The interface is small, the bundle stays around 30 KB gzipped,
and there's one source of truth for each parameter.

## 6. One way to stop: Wind down, then End

**Decision.** There is no Pause. Every stop input (the button, Esc, the
menu-bar item, a global shortcut) walks the same ladder: Playing → Wind
down → End. Wind down takes about 6 s to a low, warm hum (or to silence,
Focus's default) and stays there until Resume or End. The play control
(the well) means start or resume.

**Why.** For a drone, pausing means a sudden silence, which is exactly what
the main user finds hard. Two stop verbs also force a decision at the
moment someone least wants one. The ladder makes the gentle path the only
path. Esc ignores key repeat and needs a second deliberate press at least a
second later to end.

**Revisit if** Focus users miss a plain pause for calls; Wind down to
silence is meant to cover that.

## 7. A rest in the hum after the Meditate timer

**Decision.** When a timed Meditate session ends, a single soft bell
sounds, the sound winds down to the hum, rests for 2 minutes (adjustable,
or none), then fades out over 20 s.

**Why.** Coming out of a sit slowly, rather than opening your eyes and
standing straight away, is common advice in mantra meditation.

## 8. The mini player is opaque

**Decision.** The window is shaped (rounded, transparent outside the
panel) but its surface is opaque.

**Why.** Translucency would let bright windows passing behind an
always-on-top player change its brightness on their own and lower text
contrast. The color tokens are chosen for WCAG AA text contrast and 3:1
for control outlines on the opaque grounds.

## 9. Visuals live in their own window

**Decision.** Visuals open on demand in a separate window and are the only
thing that renders continuously. Closing the window destroys it, so with
no visuals open there is no WebGL context and no animation loop. The mini
player's only motion is a CSS opacity animation in Meditate (paused when
the window is hidden), timed to the drone's filter sweep.

The fifteen scenes share one fragment shader, chosen by uniform, and
cross-fade over 9 s; palette changes cross-fade over about 4 s. Photosensitivity measures: every brightness input is smoothed (time
constants of 1 s or more) and slew-limited; there's a global brightness
cap that Calm visuals lowers further; the beat frequency is never fed to
the picture; Esc fades to dark within about a second; and a note about
photosensitive epilepsy appears before the first use.

**Revisit when** compile time or GPU cost grows with more scenes: compile
one program per scene and cross-fade by blending.

## 10. Native touches are behind platform checks

**Decision.** The Rust side owns the menu-bar menu (built from a
description the page sends), keep-awake (`keepawake` crate), and an
output-device watcher that polls CoreAudio once a second. macOS-only code
sits behind `cfg(target_os = "macos")` with harmless fallbacks, so
Windows and Linux builds should compile and play, untested.

The page decides how the session reacts: if the previous output
disappeared, it mutes and waits; if the output switched, it dips and fades
back in over 3 s; if the output is built-in or display speakers, a
binaural beat plays as a monaural one, since binaural needs headphones.

## 11. Everything stays on the Mac

**Decision.** Settings, presets and session preferences live in one JSON
file in the app's data folder (Tauri store plugin). There are no accounts
and no analytics. The only network use is the daily update check and
downloading an update (see 21), and the only links that leave the app are Learn's source links,
which open in the default browser when clicked.

## 12. Learn cites what it says

**Decision.** Each Learn card lists numbered sources with DOIs or stable
links, and every factual sentence points to one. Sources were checked by
opening the record (PubMed via NCBI's E-utilities, Crossref or the
publisher). Where only an abstract could be read, the card only claims what
the abstract says, and where evidence is thin the card says so.

## 13. Media keys only while a session runs

**Decision.** While a session is playing or resting, Tonewell registers
with macOS's Now Playing controls (MPRemoteCommandCenter and
MPNowPlayingInfoCenter, from the Rust side), so the play/pause key and
headphone buttons walk the same ladder as Esc: start, wind down, end. When
no session is running it reports itself stopped and clears its Now Playing
entry, so those keys go back to Music, Spotify or whatever else was
playing.

**Why.** Eyes-closed control is the point: during a sit the headphones are
the only control within reach. Holding on to the media keys while idle
would steal them from other apps.

## 14. Errors are logged locally, never reported

**Decision.** Uncaught errors in any window are written to the app's
standard error output, and diagnostics flags (`TONEWELL_AUTOSTART`,
`TONEWELL_HIDE`, `TONEWELL_LOG`, `TONEWELL_PRESET`, `TONEWELL_OPEN`) let
automated checks start sessions, hide the window and print the
scheduler's health. Nothing is sent anywhere.

## 15. Softening for calls asks only whether a microphone is busy

**Decision.** "Soften during calls" (off by default) polls CoreAudio every
two seconds for any input device that is running somewhere, and lowers the
volume by about 9 dB while one is. Tonewell never opens a microphone and
needs no microphone permission.

**Why.** It's the least invasive signal that a call is on. It also triggers
for dictation or a voice memo, which is fine for a softening, and is why
it's opt-in.

## 16. The website is plain files, with one script that plays a taste

**Decision.** tonewell.space is the `site` folder: hand-written HTML and
CSS using the app's own tokens and components, the Figtree font and SVG
art, served as static files and deployed whenever `main` is pushed. Its
one script is the "Hear a taste" button, which plays thirty seconds of
Deep Theta from the app's real engine. `npm run site` builds it from
`src/site` into `site/assets/js`, and the output is committed, so the
server never runs a build. The engine is a separate file that loads only
when the button is pressed. Nothing on the page autoplays.

The visuals panel works the same way: it runs the app's own renderer
and shader, loaded only when "Watch the visuals" is pressed, next to a
note about light. The stills around it are rendered from the same code
(`npm run site:scenes`).

**Why.** The site keeps the app's own promise: no cookies, no analytics,
no third-party requests. Plain files keep it that way and keep deploys
simple. Playing the real engine rather than a recording means the taste
is the actual sound, with no recording to make or keep in step.

## 17. One renderer holds the visuals' limits

**Decision.** `src/visuals/renderer.ts` owns the WebGL program, scene
cross-fades and every smoothing and rate limit on brightness. The
Visuals window and the website only choose targets (how bright, how
fast, how much to follow the sound), and both pass through the same
limits.

**Why.** The 3 Hz rule should live in one place that no host can skip.
A second copy for the website would drift from the app's.

## 18. The visuals follow how the sound changes, and never the beat

**Decision.** The visuals listen to the bed before the beat joins it
(`bedLevels()`, a second analyser on the landing gain), measured in
decibels from the float spectrum: the drone's range (about 25–300 Hz),
where bells, voices and rain sit (about 730–2230 Hz), and overall
loudness.
`src/visuals/follow.ts` compares each with its own recent average, so
a swell, a bell or a new note registers even though a drone's level
hardly moves. The picture swells with the low end, blooms with bells,
flows faster when the sound grows, and shifts color when the drone
changes note. Silence, a suspended context or a silent start counts as
nothing heard, and following eases in over the first seconds of sound,
so starting or resuming never reads as a sudden swell. "Follow the
sound" scales all of it, and the renderer's limits smooth and slow
everything it draws.

**Why.** Following absolute levels showed almost nothing: the output's
low band sat near the analyser's byte ceiling and the old high band was
at the noise floor. Measuring after the beat also let two carriers a
few hertz apart, which pulse at the beat frequency when mixed, into the
picture (in Night Drone, fourteen times more beat in the output's low
band than in the bed's). Tapping the bed keeps the beat out by
construction, not by smoothing.

## 19. The player is a light, a line of help and two chips

**Decision.** The player is 380 × 156: a round light that starts, shows
the minutes and winds down; the mode and the sound's name; one hint line;
and two chips that change with the session (length and beat at rest,
Wind down and volume while playing, Resume and End while resting).
The hint line is the help: it describes the sound at rest and explains
whatever the pointer or keyboard focus is on, at once. Rest messages and
notices take the place of the name, hint and chips, so the window never
changes size for them. Notices rank (paused > stopped > muted >
output > softer): a lower one waits behind a higher one and is dropped if
it no longer applies when its turn comes. Figtree replaces both earlier
typefaces, and the colours follow the mode and the phase, changing over
8 s while sound plays and 240 ms otherwise.

**Why.** The first player had three sliders, a beat chip and a well you
wound by dragging, which few people would find. Help that waits for a
tooltip doesn't help someone with eyes half closed. Length, beat and
sound each now have one place, named the same way everywhere.

## 20. Mini mode is the light alone

**Decision.** ⌘M, the player's mini tool or the right-click menu shrinks
the window to its light: a 112 px circle that stays exactly where the
light was. Everything else fades over 240 ms, then the window resizes
around the light with the system's own animation while CSS holds the
light still on screen; growing back runs the same steps in reverse.
Clicking the light opens the player again (a click never stops the
sound there); dragging it, from the rim or with any press that moves,
moves the window. Esc, the menu bar, media keys and headphone buttons
work as always. Mini mode is remembered across launches.

**Why.** During work the useful glance is "is it on, how long is left",
and the light already answers both. A smaller window that keeps the same
object in the same place is calmer than a different compact layout, and
nothing in it can be pressed by accident.

## 21. Updates arrive quietly and install only between sessions

**Decision.** Once a day, 60 s after launch and then hourly whether a day
has passed, the app fetches https://tonewell.space/updates/latest.json
(Tauri's updater plugin). The request is a fixed URL with the plugin's
user agent: no version, platform or identifier. A newer version downloads
in the background from the project's GitHub release (whose file names
say the platform, and whose download counts GitHub publishes), waits in
the app's cache folder, and must carry a signature from the Tonewell
updater key that names that version. It installs when the app quits, where that needs no password (macOS
when the app and its folder are writable, the AppImage in a writable
folder, the per-user Windows installer run silently; never a .deb), or
when the person presses Restart on the player's notice. Nothing about
updates appears while sound plays, and no session can start while
Restart installs. Settings has a switch that stops the checks and drops
a waiting update, a Check now button and the current version; the menu
bar and app menus offer Check for updates. Windows gets only the
per-user installer: an .msi installs for all users and couldn't update
without an administrator.

Releases are published by `scripts/release.sh` on the Mac that holds the
keys: CI builds Windows and Linux bundles for a version tag into a draft
GitHub release, and the script adds the notarized universal Mac build,
signs every update, publishes the release and writes the manifest into
`site/`, which goes live when pushed.

**Why.** Friends testing the beta should get fixes without having to
remember to download them, and a menu-bar app is rarely quit, so a quit
alone would install too seldom. An update that restarts the app mid-sit
would break the rule that nothing startles, so it waits. The manifest
lives on the project's own domain so the binaries can move without
stranding installed copies, and keeping the updater key off CI means
publishing an update needs the release Mac, not just push access.
