package com.shuumy.wave

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.IBinder
import android.os.SystemClock
import androidx.core.content.ContextCompat

class PlaybackService : Service() {

    companion object {
        const val ACTION_UPDATE = "com.shuumy.wave.action.UPDATE_PLAYBACK"
        const val ACTION_PLAY = "com.shuumy.wave.action.PLAY"
        const val ACTION_PAUSE = "com.shuumy.wave.action.PAUSE"
        const val ACTION_PREVIOUS = "com.shuumy.wave.action.PREVIOUS"
        const val ACTION_NEXT = "com.shuumy.wave.action.NEXT"
        const val ACTION_SEEK_BACK = "com.shuumy.wave.action.SEEK_BACK"
        const val ACTION_SEEK_FORWARD = "com.shuumy.wave.action.SEEK_FORWARD"
        const val ACTION_STOP = "com.shuumy.wave.action.STOP"
        const val ACTION_MEDIA_COMMAND = "com.shuumy.wave.MEDIA_COMMAND"

        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"
        const val EXTRA_ALBUM = "album"
        const val EXTRA_ARTWORK_PATH = "artwork_path"
        const val EXTRA_PLAYING = "playing"
        const val EXTRA_POSITION_MS = "position_ms"
        const val EXTRA_DURATION_MS = "duration_ms"
        const val EXTRA_COMMAND = "command"
        const val EXTRA_SEEK_MS = "seek_ms"

        const val COMMAND_PLAY = "play"
        const val COMMAND_PAUSE = "pause"
        const val COMMAND_PREVIOUS = "previous"
        const val COMMAND_NEXT = "next"
        const val COMMAND_SEEK_BACK = "seekbackward"
        const val COMMAND_SEEK_FORWARD = "seekforward"
        const val COMMAND_SEEK_TO = "seekto"
        const val COMMAND_STOP = "stop"

        private const val CHANNEL_ID = "wave_playback"
        private const val NOTIFICATION_ID = 4102
        private const val SEEK_STEP_MS = 10_000L
    }

    private lateinit var notificationManager: NotificationManager
    private lateinit var mediaSession: MediaSession
    private lateinit var fallbackArtwork: Bitmap

    private var title = "WAVE"
    private var artist = "Lecture audio"
    private var album = "WAVE"
    private var artworkPath: String? = null
    private var artwork: Bitmap? = null
    private var playing = false
    private var positionMs = 0L
    private var durationMs = 0L

    override fun onCreate() {
        super.onCreate()
        notificationManager = getSystemService(NotificationManager::class.java)
        createNotificationChannel()
        fallbackArtwork = renderLauncherIcon()

        val openAppIntent = PendingIntent.getActivity(
            this,
            100,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        mediaSession = MediaSession(this, "WAVE").apply {
            setFlags(
                MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or
                    MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS,
            )
            setSessionActivity(openAppIntent)
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = dispatchCommand(COMMAND_PLAY)
                override fun onPause() = dispatchCommand(COMMAND_PAUSE)
                override fun onSkipToPrevious() = dispatchCommand(COMMAND_PREVIOUS)
                override fun onSkipToNext() = dispatchCommand(COMMAND_NEXT)
                override fun onSeekTo(pos: Long) = dispatchCommand(COMMAND_SEEK_TO, pos)
                override fun onStop() = stopPlayback(true)
            })
            isActive = true
        }
        updateMediaSession()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_UPDATE -> applyUpdate(intent)
            ACTION_PLAY -> dispatchCommand(COMMAND_PLAY)
            ACTION_PAUSE -> dispatchCommand(COMMAND_PAUSE)
            ACTION_PREVIOUS -> dispatchCommand(COMMAND_PREVIOUS)
            ACTION_NEXT -> dispatchCommand(COMMAND_NEXT)
            ACTION_SEEK_BACK -> dispatchCommand(COMMAND_SEEK_BACK, SEEK_STEP_MS)
            ACTION_SEEK_FORWARD -> dispatchCommand(COMMAND_SEEK_FORWARD, SEEK_STEP_MS)
            ACTION_STOP -> stopPlayback(true)
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        stopPlayback(true)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        mediaSession.isActive = false
        mediaSession.release()
        artwork?.takeIf { it !== fallbackArtwork }?.recycle()
        if (!fallbackArtwork.isRecycled) fallbackArtwork.recycle()
        super.onDestroy()
    }

    private fun applyUpdate(intent: Intent) {
        title = intent.getStringExtra(EXTRA_TITLE)?.take(180)?.ifBlank { "WAVE" } ?: title
        artist = intent.getStringExtra(EXTRA_ARTIST)?.take(180)?.ifBlank { "Lecture audio" } ?: artist
        album = intent.getStringExtra(EXTRA_ALBUM)?.take(180)?.ifBlank { "WAVE" } ?: album
        playing = intent.getBooleanExtra(EXTRA_PLAYING, playing)
        positionMs = intent.getLongExtra(EXTRA_POSITION_MS, positionMs).coerceAtLeast(0L)
        durationMs = intent.getLongExtra(EXTRA_DURATION_MS, durationMs).coerceAtLeast(0L)

        val newArtworkPath = intent.getStringExtra(EXTRA_ARTWORK_PATH)
        if (newArtworkPath != artworkPath) {
            artworkPath = newArtworkPath
            val decoded = newArtworkPath
                ?.takeIf { it.isNotBlank() }
                ?.let { BitmapFactory.decodeFile(it) }
            artwork?.takeIf { it !== fallbackArtwork }?.recycle()
            artwork = decoded
        }

        updateMediaSession()
        startForeground(NOTIFICATION_ID, buildNotification())
    }

    private fun dispatchCommand(command: String, seekMs: Long = 0L) {
        when (command) {
            COMMAND_PLAY -> playing = true
            COMMAND_PAUSE -> playing = false
            COMMAND_SEEK_BACK -> positionMs = (positionMs - seekMs).coerceAtLeast(0L)
            COMMAND_SEEK_FORWARD -> {
                val target = positionMs + seekMs
                positionMs = if (durationMs > 0L) target.coerceAtMost(durationMs) else target
            }
            COMMAND_SEEK_TO -> {
                positionMs = if (durationMs > 0L) {
                    seekMs.coerceIn(0L, durationMs)
                } else {
                    seekMs.coerceAtLeast(0L)
                }
            }
        }

        sendBroadcast(
            Intent(ACTION_MEDIA_COMMAND)
                .setPackage(packageName)
                .putExtra(EXTRA_COMMAND, command)
                .putExtra(EXTRA_SEEK_MS, seekMs),
        )

        updateMediaSession()
        startForeground(NOTIFICATION_ID, buildNotification())
    }

    private fun stopPlayback(notifyWeb: Boolean) {
        playing = false
        positionMs = 0L
        if (notifyWeb) {
            sendBroadcast(
                Intent(ACTION_MEDIA_COMMAND)
                    .setPackage(packageName)
                    .putExtra(EXTRA_COMMAND, COMMAND_STOP),
            )
        }
        updateMediaSession()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun updateMediaSession() {
        val supportedActions =
            PlaybackState.ACTION_PLAY or
                PlaybackState.ACTION_PAUSE or
                PlaybackState.ACTION_PLAY_PAUSE or
                PlaybackState.ACTION_SKIP_TO_PREVIOUS or
                PlaybackState.ACTION_SKIP_TO_NEXT or
                PlaybackState.ACTION_REWIND or
                PlaybackState.ACTION_FAST_FORWARD or
                PlaybackState.ACTION_SEEK_TO or
                PlaybackState.ACTION_STOP

        val state = if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED
        mediaSession.setPlaybackState(
            PlaybackState.Builder()
                .setActions(supportedActions)
                .setState(
                    state,
                    positionMs,
                    if (playing) 1f else 0f,
                    SystemClock.elapsedRealtime(),
                )
                .build(),
        )

        val currentArtwork = artwork ?: fallbackArtwork
        mediaSession.setMetadata(
            MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs)
                .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, currentArtwork)
                .putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, currentArtwork)
                .build(),
        )
        mediaSession.isActive = true
    }

    private fun buildNotification(): Notification {
        val contentIntent = PendingIntent.getActivity(
            this,
            101,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val previousAction = Notification.Action.Builder(
            android.R.drawable.ic_media_previous,
            getString(R.string.media_previous),
            servicePendingIntent(ACTION_PREVIOUS, 201),
        ).build()
        val rewindAction = Notification.Action.Builder(
            android.R.drawable.ic_media_rew,
            getString(R.string.media_rewind),
            servicePendingIntent(ACTION_SEEK_BACK, 202),
        ).build()
        val playPauseAction = Notification.Action.Builder(
            if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
            getString(if (playing) R.string.media_pause else R.string.media_play),
            servicePendingIntent(if (playing) ACTION_PAUSE else ACTION_PLAY, 203),
        ).build()
        val forwardAction = Notification.Action.Builder(
            android.R.drawable.ic_media_ff,
            getString(R.string.media_forward),
            servicePendingIntent(ACTION_SEEK_FORWARD, 204),
        ).build()
        val nextAction = Notification.Action.Builder(
            android.R.drawable.ic_media_next,
            getString(R.string.media_next),
            servicePendingIntent(ACTION_NEXT, 205),
        ).build()

        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_wave)
            .setLargeIcon(artwork ?: fallbackArtwork)
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText(album)
            .setContentIntent(contentIntent)
            .setDeleteIntent(servicePendingIntent(ACTION_STOP, 206))
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setColor(Color.rgb(255, 204, 0))
            .setColorized(false)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .setShowWhen(false)
            .addAction(previousAction)
            .addAction(rewindAction)
            .addAction(playPauseAction)
            .addAction(forwardAction)
            .addAction(nextAction)
            .setStyle(
                Notification.MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 2, 4),
            )
            .build()
    }

    private fun servicePendingIntent(action: String, requestCode: Int): PendingIntent {
        return PendingIntent.getService(
            this,
            requestCode,
            Intent(this, PlaybackService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.media_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.media_channel_description)
            setSound(null, null)
            enableVibration(false)
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        notificationManager.createNotificationChannel(channel)
    }

    private fun renderLauncherIcon(): Bitmap {
        val size = 512
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val drawable = ContextCompat.getDrawable(this, R.mipmap.ic_launcher)
        drawable?.setBounds(0, 0, size, size)
        drawable?.draw(canvas)
        return bitmap
    }
}
