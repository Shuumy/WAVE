package com.shuumy.wave

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError
import android.widget.ProgressBar
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.roundToInt

class MainActivity : AppCompatActivity() {

    companion object {
        private const val WAVE_URL = "https://shuumy.github.io/WAVE/"
        private const val WAVE_HOST = "shuumy.github.io"
        private const val RELOCK_DELAY_MS = 30_000L
        private const val MAX_ARTWORK_BYTES = 3 * 1024 * 1024
        private const val AUTHENTICATORS =
            BiometricManager.Authenticators.BIOMETRIC_STRONG or
                BiometricManager.Authenticators.DEVICE_CREDENTIAL
    }

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var unlocked = false
    private var authenticating = false
    private var activityVisible = false
    private var backgroundAt = 0L

    private var mediaPlaying = false
    private var playbackServiceStarted = false
    private var mediaTitle = "WAVE"
    private var mediaArtist = "Lecture audio"
    private var mediaAlbum = "WAVE"
    private var mediaArtworkPath: String? = null
    private var mediaPositionMs = 0L
    private var mediaDurationMs = 0L

    private val artworkExecutor = Executors.newSingleThreadExecutor()
    private val artworkGeneration = AtomicInteger(0)
    private var mediaReceiverRegistered = false

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* Le système conserve le choix de l’utilisateur. */ }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val uris = WebChromeClient.FileChooserParams.parseResult(
            result.resultCode,
            result.data,
        )
        fileChooserCallback?.onReceiveValue(uris)
        fileChooserCallback = null
    }

    private val mediaCommandReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val command = intent?.getStringExtra(PlaybackService.EXTRA_COMMAND) ?: return
            val seekMs = intent.getLongExtra(PlaybackService.EXTRA_SEEK_MS, 0L)

            when (command) {
                PlaybackService.COMMAND_PLAY -> {
                    mediaPlaying = true
                    backgroundAt = 0L
                }
                PlaybackService.COMMAND_PAUSE -> {
                    mediaPlaying = false
                    if (!activityVisible) backgroundAt = SystemClock.elapsedRealtime()
                }
                PlaybackService.COMMAND_STOP -> {
                    mediaPlaying = false
                    playbackServiceStarted = false
                    if (!activityVisible) backgroundAt = SystemClock.elapsedRealtime()
                }
            }

            val seconds = seekMs.toDouble() / 1000.0
            val quotedCommand = JSONObject.quote(command)
            webView.evaluateJavascript(
                "if(window.WAVE_NATIVE_MEDIA_COMMAND){window.WAVE_NATIVE_MEDIA_COMMAND($quotedCommand,$seconds);}",
                null,
            )
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.waveWebView)
        progressBar = findViewById(R.id.waveProgress)
        registerMediaCommandReceiver()
        configureWebView()
        configureBackNavigation()
        requestUnlock()
    }

    override fun onStart() {
        super.onStart()
        activityVisible = true
        if (
            unlocked &&
            !mediaPlaying &&
            backgroundAt > 0L &&
            SystemClock.elapsedRealtime() - backgroundAt >= RELOCK_DELAY_MS
        ) {
            unlocked = false
            requestUnlock()
        }
    }

    override fun onStop() {
        activityVisible = false
        if (!mediaPlaying) backgroundAt = SystemClock.elapsedRealtime()
        else backgroundAt = 0L
        super.onStop()
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        if (mediaReceiverRegistered) {
            unregisterReceiver(mediaCommandReceiver)
            mediaReceiverRegistered = false
        }
        artworkExecutor.shutdownNow()
        if (isFinishing) {
            stopService(Intent(this, PlaybackService::class.java))
            playbackServiceStarted = false
        }
        webView.stopLoading()
        webView.removeJavascriptInterface("WaveAndroid")
        webView.destroy()
        super.onDestroy()
    }

    private fun requestUnlock() {
        if (authenticating || unlocked) return

        val status = BiometricManager.from(this).canAuthenticate(AUTHENTICATORS)
        if (status != BiometricManager.BIOMETRIC_SUCCESS) {
            showMissingDeviceLockDialog()
            return
        }

        authenticating = true
        webView.visibility = View.INVISIBLE

        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(
                    result: BiometricPrompt.AuthenticationResult,
                ) {
                    super.onAuthenticationSucceeded(result)
                    authenticating = false
                    unlocked = true
                    backgroundAt = 0L
                    webView.visibility = View.VISIBLE
                    if (webView.url.isNullOrBlank()) webView.loadUrl(WAVE_URL)
                    requestNotificationPermissionIfNeeded()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    super.onAuthenticationError(errorCode, errString)
                    authenticating = false
                    unlocked = false
                    finishAndRemoveTask()
                }
            },
        )

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle(getString(R.string.unlock_title))
            .setSubtitle(getString(R.string.unlock_subtitle))
            .setAllowedAuthenticators(AUTHENTICATORS)
            .build()

        prompt.authenticate(promptInfo)
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun showMissingDeviceLockDialog() {
        AlertDialog.Builder(this)
            .setTitle(R.string.device_lock_required_title)
            .setMessage(R.string.device_lock_required_message)
            .setCancelable(false)
            .setPositiveButton(R.string.open_settings) { _, _ ->
                try {
                    startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))
                } catch (_: ActivityNotFoundException) {
                    startActivity(Intent(Settings.ACTION_SETTINGS))
                }
                finishAndRemoveTask()
            }
            .setNegativeButton(R.string.close_app) { _, _ -> finishAndRemoveTask() }
            .show()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = true
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            safeBrowsingEnabled = true
        }

        // Cette interface ne permet ni accès aux fichiers ni exécution native arbitraire.
        // Elle accepte uniquement des métadonnées et l’état du lecteur WAVE.
        webView.addJavascriptInterface(WaveAndroidBridge(), "WaveAndroid")

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                progressBar.visibility = View.GONE
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                if (!request.isForMainFrame) return false
                val uri = request.url
                if (uri.scheme == "https" && uri.host == WAVE_HOST) return false
                openExternal(uri)
                return true
            }

            override fun onReceivedSslError(
                view: WebView?,
                handler: SslErrorHandler,
                error: SslError?,
            ) {
                handler.cancel()
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                if (request.isForMainFrame) {
                    progressBar.visibility = View.GONE
                    view.loadDataWithBaseURL(
                        WAVE_URL,
                        getString(R.string.offline_html),
                        "text/html",
                        "UTF-8",
                        null,
                    )
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                request.deny()
            }

            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams,
            ): Boolean {
                this@MainActivity.fileChooserCallback?.onReceiveValue(null)
                this@MainActivity.fileChooserCallback = filePathCallback
                return try {
                    fileChooserLauncher.launch(fileChooserParams.createIntent())
                    true
                } catch (_: ActivityNotFoundException) {
                    this@MainActivity.fileChooserCallback = null
                    filePathCallback.onReceiveValue(null)
                    false
                }
            }
        }
    }

    private fun registerMediaCommandReceiver() {
        if (mediaReceiverRegistered) return
        ContextCompat.registerReceiver(
            this,
            mediaCommandReceiver,
            IntentFilter(PlaybackService.ACTION_MEDIA_COMMAND),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        mediaReceiverRegistered = true
    }

    private inner class WaveAndroidBridge {
        @JavascriptInterface
        fun updateMetadata(payloadJson: String) {
            if (payloadJson.length > MAX_ARTWORK_BYTES * 2) return
            try {
                val payload = JSONObject(payloadJson)
                val title = safeText(payload.optString("title"), "WAVE")
                val artist = safeText(payload.optString("artist"), "Lecture audio")
                val album = safeText(payload.optString("album"), "WAVE")
                val artwork = payload.optString("artwork").takeIf {
                    it.length <= MAX_ARTWORK_BYTES * 2
                }.orEmpty()

                runOnUiThread {
                    mediaTitle = title
                    mediaArtist = artist
                    mediaAlbum = album
                    mediaArtworkPath = null
                    val generation = artworkGeneration.incrementAndGet()
                    sendPlaybackUpdate()
                    prepareArtwork(artwork, generation)
                }
            } catch (_: Exception) {
                // Métadonnées invalides : conserver les valeurs précédentes.
            }
        }

        @JavascriptInterface
        fun updatePlayback(payloadJson: String) {
            try {
                val payload = JSONObject(payloadJson)
                val playing = payload.optBoolean("playing", false)
                val position = payload.optDouble("positionMs", 0.0)
                val duration = payload.optDouble("durationMs", 0.0)

                runOnUiThread {
                    mediaPlaying = playing
                    mediaPositionMs = position.takeIf { it.isFinite() && it >= 0 }?.toLong() ?: 0L
                    mediaDurationMs = duration.takeIf { it.isFinite() && it >= 0 }?.toLong() ?: 0L
                    if (playing) backgroundAt = 0L
                    else if (!activityVisible) backgroundAt = SystemClock.elapsedRealtime()
                    sendPlaybackUpdate()
                }
            } catch (_: Exception) {
                // État invalide : ignorer sans interrompre la lecture web.
            }
        }

        @JavascriptInterface
        fun clearPlayback() {
            runOnUiThread {
                mediaPlaying = false
                playbackServiceStarted = false
                mediaPositionMs = 0L
                mediaDurationMs = 0L
                stopService(Intent(this@MainActivity, PlaybackService::class.java))
                if (!activityVisible) backgroundAt = SystemClock.elapsedRealtime()
            }
        }
    }

    private fun safeText(value: String, fallback: String): String {
        val cleaned = value.trim().replace(Regex("[\\u0000-\\u001F\\u007F]"), "")
        return cleaned.take(180).ifBlank { fallback }
    }

    private fun sendPlaybackUpdate() {
        if (!mediaPlaying && !playbackServiceStarted) return

        val intent = Intent(this, PlaybackService::class.java)
            .setAction(PlaybackService.ACTION_UPDATE)
            .putExtra(PlaybackService.EXTRA_TITLE, mediaTitle)
            .putExtra(PlaybackService.EXTRA_ARTIST, mediaArtist)
            .putExtra(PlaybackService.EXTRA_ALBUM, mediaAlbum)
            .putExtra(PlaybackService.EXTRA_ARTWORK_PATH, mediaArtworkPath)
            .putExtra(PlaybackService.EXTRA_PLAYING, mediaPlaying)
            .putExtra(PlaybackService.EXTRA_POSITION_MS, mediaPositionMs)
            .putExtra(PlaybackService.EXTRA_DURATION_MS, mediaDurationMs)

        if (mediaPlaying) {
            ContextCompat.startForegroundService(this, intent)
            playbackServiceStarted = true
        } else if (playbackServiceStarted) {
            startService(intent)
        }
    }

    private fun prepareArtwork(source: String, generation: Int) {
        if (source.isBlank()) return
        artworkExecutor.execute {
            val bitmap = decodeArtwork(source) ?: return@execute
            val scaled = scaleArtwork(bitmap)
            val output = File(cacheDir, "wave_media_art_$generation.jpg")
            try {
                FileOutputStream(output).use { stream ->
                    scaled.compress(Bitmap.CompressFormat.JPEG, 88, stream)
                }
            } catch (_: Exception) {
                output.delete()
                return@execute
            } finally {
                if (scaled !== bitmap) bitmap.recycle()
            }

            runOnUiThread {
                if (artworkGeneration.get() != generation) {
                    output.delete()
                    return@runOnUiThread
                }
                mediaArtworkPath = output.absolutePath
                sendPlaybackUpdate()
                cacheDir.listFiles { file -> file.name.startsWith("wave_media_art_") }
                    ?.filter { it.absolutePath != output.absolutePath }
                    ?.forEach { it.delete() }
            }
        }
    }

    private fun decodeArtwork(source: String): Bitmap? {
        return try {
            when {
                source.startsWith("data:image/", ignoreCase = true) -> {
                    val comma = source.indexOf(',')
                    if (comma <= 0) return null
                    val bytes = Base64.decode(source.substring(comma + 1), Base64.DEFAULT)
                    if (bytes.size > MAX_ARTWORK_BYTES) return null
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                }
                source.startsWith("https://", ignoreCase = true) -> {
                    val connection = URL(source).openConnection() as HttpURLConnection
                    connection.connectTimeout = 5_000
                    connection.readTimeout = 5_000
                    connection.instanceFollowRedirects = true
                    connection.setRequestProperty("User-Agent", "WAVE-Android")
                    try {
                        connection.connect()
                        if (connection.responseCode !in 200..299) return null
                        val bytes = connection.inputStream.use { readLimited(it, MAX_ARTWORK_BYTES) }
                            ?: return null
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    } finally {
                        connection.disconnect()
                    }
                }
                else -> null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun readLimited(input: InputStream, maxBytes: Int): ByteArray? {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            if (total > maxBytes) return null
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun scaleArtwork(source: Bitmap): Bitmap {
        val maxSide = 512
        if (source.width <= maxSide && source.height <= maxSide) return source
        val ratio = minOf(maxSide.toFloat() / source.width, maxSide.toFloat() / source.height)
        val width = (source.width * ratio).roundToInt().coerceAtLeast(1)
        val height = (source.height * ratio).roundToInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(source, width, height, true)
    }

    private fun configureBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    private fun openExternal(uri: Uri) {
        if (uri.scheme !in setOf("https", "http", "mailto")) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
            // Aucun navigateur compatible : la page WAVE reste ouverte.
        }
    }
}
