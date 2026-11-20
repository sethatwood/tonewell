package space.tonewell.playback

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.view.KeyEvent
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

data class Control(val id: String, val label: String)

data class NowPlaying(
  val playing: Boolean,
  val title: String,
  val text: String?,
  val subtext: String?,
  val controls: List<Control>,
)

/** Where the service's news goes: to the plugin, and from there to the web side. */
internal object Playback {
  @Volatile var onControl: ((String) -> Unit)? = null
  @Volatile var onFocus: ((String) -> Unit)? = null
}

/**
 * Runs while a session does. Being a media-playback foreground service is what
 * lets the sound go on with the screen locked (Android 17 requires it to start
 * while the app is in front, which a session always does). It shows the
 * session on the lock screen and in the notification shade, with the same
 * controls as the menu bar on a Mac, never a plain Pause: Wind down, then
 * Resume or End. Headphone buttons walk the same ladder.
 */
class PlaybackService : Service() {
  companion object {
    private const val TAG = "Tonewell"
    private const val CHANNEL = "session"
    private const val NOTIFICATION = 1
    private const val CONTROL = "space.tonewell.playback.CONTROL"

    @Volatile private var instance: PlaybackService? = null
    @Volatile private var pending: NowPlaying? = null
    private val main = Handler(Looper.getMainLooper())

    /** A session is running (the service exists or is starting). */
    @Volatile var active = false
      private set

    fun show(context: Context, now: NowPlaying) {
      pending = now
      val running = instance
      if (running != null) {
        main.post { running.present(now) }
        return
      }
      active = true
      ContextCompat.startForegroundService(context, Intent(context, PlaybackService::class.java))
    }

    fun stop(context: Context) {
      pending = null
      if (!active && instance == null) return
      active = false
      context.stopService(Intent(context, PlaybackService::class.java))
    }
  }

  private lateinit var session: MediaSession
  private lateinit var audio: AudioManager
  private var wake: PowerManager.WakeLock? = null
  private var focus: AudioFocusRequest? = null
  private var hasFocus = false
  private var shown: NowPlaying? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    audio = getSystemService(AudioManager::class.java)
    channel()
    session = MediaSession(this, "Tonewell").apply {
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() = control("media-play")
        override fun onPause() = control("media-pause")
        override fun onStop() = control("end")
        override fun onCustomAction(action: String, extras: Bundle?) = control(action)
        override fun onMediaButtonEvent(intent: Intent): Boolean {
          @Suppress("DEPRECATION")
          val key: KeyEvent? = intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT)
          // One press on a headset's button: the same step as the play/pause key on a Mac.
          if (key != null && (key.keyCode == KeyEvent.KEYCODE_HEADSETHOOK || key.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)) {
            if (key.action == KeyEvent.ACTION_DOWN && key.repeatCount == 0) control("media-toggle")
            return true
          }
          return super.onMediaButtonEvent(intent)
        }
      })
      isActive = true
    }
    // Audio playing keeps the phone awake by itself; this also covers silent rests and breaks.
    wake = getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Tonewell:session")
      .apply {
        setReferenceCounted(false)
        acquire(24 * 60 * 60 * 1000L)
      }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == CONTROL) {
      intent.getStringExtra("id")?.let { control(it) }
      if (!active) stopSelf()
      return START_NOT_STICKY
    }
    val now = pending ?: shown
    if (now == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    // Must come promptly after startForegroundService, before anything else can fail.
    ServiceCompat.startForeground(this, NOTIFICATION, notification(now), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    present(now)
    return START_NOT_STICKY
  }

  /** Swiping Tonewell away closes the webview, and the sound with it. */
  override fun onTaskRemoved(rootIntent: Intent?) {
    active = false
    stopSelf()
  }

  override fun onDestroy() {
    instance = null
    active = false
    focus?.let { audio.abandonAudioFocusRequest(it) }
    hasFocus = false
    session.isActive = false
    session.release()
    wake?.takeIf { it.isHeld }?.release()
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun control(id: String) {
    Log.i(TAG, "control: $id")
    Playback.onControl?.invoke(id)
  }

  fun present(now: NowPlaying) {
    shown = now
    if (now.playing && !hasFocus) requestFocus()
    session.setMetadata(
      MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_TITLE, now.title)
        .putString(MediaMetadata.METADATA_KEY_ARTIST, now.text ?: "")
        .putString(MediaMetadata.METADATA_KEY_ALBUM, now.subtext ?: "")
        .build(),
    )
    session.setPlaybackState(playbackState(now))
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification(now))
  }

  private fun has(now: NowPlaying, vararg ids: String) = now.controls.any { it.id in ids }

  /**
   * The system's own play/pause button is the first step of the ladder: Pause
   * winds down, Play resumes (or starts the next block after a break). Every
   * other control (End) is a custom action beside it.
   */
  private fun playbackState(now: NowPlaying): PlaybackState {
    var actions = PlaybackState.ACTION_STOP
    if (now.playing && has(now, "wind")) actions = actions or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE
    if (!now.playing && has(now, "resume")) actions = actions or PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PLAY_PAUSE
    val builder = PlaybackState.Builder()
      .setState(
        if (now.playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
        PlaybackState.PLAYBACK_POSITION_UNKNOWN,
        if (now.playing) 1f else 0f,
      )
      .setActions(actions)
    for (c in now.controls) {
      if (c.id == "wind" || c.id == "resume") continue
      builder.addCustomAction(PlaybackState.CustomAction.Builder(c.id, c.label, iconFor(c.id)).build())
    }
    return builder.build()
  }

  private fun iconFor(id: String): Int = when (id) {
    "wind" -> R.drawable.playback_wind
    "resume" -> R.drawable.playback_resume
    "end" -> R.drawable.playback_end
    else -> R.drawable.playback_light
  }

  private fun notification(now: NowPlaying): Notification {
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val builder = Notification.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.playback_light)
      .setContentTitle(now.title)
      .setContentText(now.text)
      .setSubText(now.subtext)
      .setContentIntent(open)
      .setOngoing(true)
      .setShowWhen(false)
      .setOnlyAlertOnce(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setCategory(Notification.CATEGORY_TRANSPORT)
    if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    // Older Androids draw these buttons; newer ones draw the session's own (above).
    now.controls.forEachIndexed { i, c ->
      val intent = Intent(this, PlaybackService::class.java).setAction(CONTROL).putExtra("id", c.id)
      val pending = PendingIntent.getService(this, 100 + i, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      builder.addAction(Notification.Action.Builder(Icon.createWithResource(this, iconFor(c.id)), c.label, pending).build())
    }
    val compact = IntArray(minOf(now.controls.size, 3)) { it }
    builder.setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(*compact))
    return builder.build()
  }

  private fun channel() {
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) != null) return
    val channel = NotificationChannel(CHANNEL, "Session", NotificationManager.IMPORTANCE_LOW).apply {
      description = "The session that is playing, with its controls."
      setShowBadge(false)
      setSound(null, null)
      enableVibration(false)
    }
    manager.createNotificationChannel(channel)
  }

  /**
   * Other apps' sound. A call or another app speaking briefly softens the
   * session (the web side decides how much); another app starting to play for
   * good pauses it quietly, waiting for Resume or End, as unplugging does.
   */
  private fun requestFocus() {
    val request = focus ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build(),
      )
      .setWillPauseWhenDucked(false)
      .setOnAudioFocusChangeListener({ change ->
        val state = when (change) {
          AudioManager.AUDIOFOCUS_GAIN -> "gain"
          AudioManager.AUDIOFOCUS_LOSS -> "loss"
          AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> "transient"
          AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> "duck"
          else -> return@setOnAudioFocusChangeListener
        }
        hasFocus = change == AudioManager.AUDIOFOCUS_GAIN || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
        Log.i(TAG, "audio focus: $state")
        Playback.onFocus?.invoke(state)
      }, main)
      .build()
    focus = request
    hasFocus = audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    Log.i(TAG, "audio focus requested: $hasFocus")
  }
}
