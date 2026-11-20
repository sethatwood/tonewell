package space.tonewell.playback

import android.app.Activity
import android.util.Log
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class ControlArg {
  lateinit var id: String
  lateinit var label: String
}

@InvokeArg
class UpdateArgs {
  /** "playing", "paused" (winding down or resting) or "stopped" (no session). */
  lateinit var state: String
  var title: String = "Tonewell"
  var text: String? = null
  var subtext: String? = null
  /** The session's controls right now, in the menu bar's words: Wind down, Resume, End… */
  var controls: Array<ControlArg> = arrayOf()
}

@InvokeArg
class SwitchArgs {
  var on: Boolean = false
}

/**
 * The web side's way to the phone. While a session runs, a foreground service
 * keeps the process (and so the webview making the sound) alive with the
 * screen locked, and shows the session on the lock screen. Controls pressed
 * there, or on headphones, come back as `action` events; headphones and other
 * outputs as `output` events; other apps' sound as `focus` events.
 */
@TauriPlugin
class PlaybackPlugin(private val activity: Activity) : Plugin(activity) {
  private var webView: WebView? = null
  private var outputs: Outputs? = null
  private var back: OnBackPressedCallback? = null

  override fun load(webView: WebView) {
    this.webView = webView
    Playback.onControl = { id -> trigger("action", JSObject().put("id", id)) }
    Playback.onFocus = { state -> trigger("focus", JSObject().put("state", state)) }
    outputs = Outputs(activity.applicationContext) { change -> trigger("output", change) }.also { it.start() }
    (activity as? AppCompatActivity)?.let { owner ->
      owner.runOnUiThread {
        val callback = object : OnBackPressedCallback(false) {
          override fun handleOnBackPressed() = trigger("back", JSObject())
        }
        owner.onBackPressedDispatcher.addCallback(owner, callback)
        back = callback
      }
    }
  }

  /**
   * The activity pausing (the screen locking, another app in front) pauses the
   * webview too. While a session plays that would be the sound, so undo it:
   * the page is hidden either way, and stays light.
   */
  override fun onPause(activity: AppCompatActivity) {
    if (PlaybackService.active) webView?.onResume()
  }

  override fun onDestroy(activity: AppCompatActivity) {
    outputs?.stop()
    outputs = null
    // The webview, and with it the sound, is gone: so is the session.
    PlaybackService.stop(activity.applicationContext)
  }

  @Command
  fun update(invoke: Invoke) {
    val args = invoke.parseArgs(UpdateArgs::class.java)
    val context = activity.applicationContext
    if (args.state == "stopped") {
      PlaybackService.stop(context)
    } else {
      val now = NowPlaying(
        playing = args.state == "playing",
        title = args.title,
        text = args.text,
        subtext = args.subtext,
        controls = args.controls.map { Control(it.id, it.label) },
      )
      try {
        PlaybackService.show(context, now)
      } catch (err: Exception) {
        // Android only lets an app start playing in the background from the front.
        Log.w("Tonewell", "playback service unavailable", err)
        invoke.reject(err.message ?: "playback service unavailable")
        return
      }
    }
    invoke.resolve()
  }

  @Command
  fun output(invoke: Invoke) {
    val current = outputs?.current() ?: Outputs(activity.applicationContext) {}.current()
    invoke.resolve(current)
  }

  @Command
  fun keepScreenOn(invoke: Invoke) {
    val on = invoke.parseArgs(SwitchArgs::class.java).on
    activity.runOnUiThread {
      if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    invoke.resolve()
  }

  /** While a sheet or a page is open, Back closes it (a `back` event) instead of leaving the app. */
  @Command
  fun handleBack(invoke: Invoke) {
    val on = invoke.parseArgs(SwitchArgs::class.java).on
    activity.runOnUiThread { back?.isEnabled = on }
    invoke.resolve()
  }
}
