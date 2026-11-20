package space.tonewell.playback

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import app.tauri.plugin.JSObject

/**
 * Where the sound goes, in the shape the Mac's watcher reports it:
 * `{ name, kind: "headphones" | "speakers" | "unknown", muted }`, and changes
 * as `{ change: "removed" | "switched", previous, current }`. Headphones
 * coming out is reported the moment Android announces it, before the sound
 * can move to the speaker.
 */
internal class Outputs(private val context: Context, private val changed: (JSObject) -> Unit) {
  private val audio = context.getSystemService(AudioManager::class.java)
  private val main = Handler(Looper.getMainLooper())
  private var last: JSObject? = null
  private var started = false

  private val media = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_MEDIA)
    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
    .build()

  private val devices = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = settleSoon()
    override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = settleSoon()
  }

  private val noisy = object : BroadcastReceiver() {
    override fun onReceive(c: Context, intent: Intent) {
      if (intent.action != AudioManager.ACTION_AUDIO_BECOMING_NOISY) return
      val previous = last ?: return
      if (previous.getString("kind") != "headphones") return
      val speaker = output("Phone speaker", "speakers")
      last = speaker
      changed(JSObject().put("change", "removed").put("previous", previous).put("current", speaker))
    }
  }

  private val settle = Runnable { compare() }

  fun start() {
    if (started) return
    started = true
    last = current()
    audio.registerAudioDeviceCallback(devices, main)
    ContextCompat.registerReceiver(context, noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED)
  }

  fun stop() {
    if (!started) return
    started = false
    audio.unregisterAudioDeviceCallback(devices)
    context.unregisterReceiver(noisy)
    main.removeCallbacks(settle)
  }

  /** Devices come and go in bursts (a headset is several devices): wait for the last. */
  private fun settleSoon() {
    main.removeCallbacks(settle)
    main.postDelayed(settle, 400)
  }

  private fun compare() {
    val previous = last
    val now = current()
    last = now
    if (previous == null || previous.getString("name") == now.getString("name")) return
    val gone = previous.getString("kind") == "headphones" && now.getString("kind") != "headphones"
    changed(JSObject().put("change", if (gone) "removed" else "switched").put("previous", previous).put("current", now))
  }

  fun current(): JSObject {
    val device = if (Build.VERSION.SDK_INT >= 33) {
      audio.getAudioDevicesForAttributes(media).firstOrNull()
    } else {
      audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull { isHeadphones(it.type) }
    }
    if (device == null || device.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER || device.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {
      return output("Phone speaker", "speakers")
    }
    val kind = if (isHeadphones(device.type)) "headphones" else "unknown"
    // Wired headphones report the phone's own model as their name.
    val product = device.productName?.toString()?.trim().orEmpty()
    val name = if (product.isEmpty() || product == Build.MODEL) {
      if (kind == "headphones") "Headphones" else "Speaker"
    } else {
      product
    }
    return output(name, kind)
  }

  private fun output(name: String, kind: String) =
    JSObject().put("name", name).put("kind", kind).put("muted", false)

  private fun isHeadphones(type: Int) = when (type) {
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_HEARING_AID,
    AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_BLE_BROADCAST -> true
    else -> false
  }
}
