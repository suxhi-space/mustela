package app.mustela.nativecall

import android.Manifest
import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.AudioDeviceInfo
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Rational
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.WindowCompat
import androidx.activity.result.ActivityResult
import app.tauri.PermissionState
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.JSArray
import app.tauri.plugin.Plugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray

@InvokeArg
class StartCallArgs {
    var url: String = ""
    var token: String = ""
    var channelId: String = ""
    var channelName: String = ""
}

@InvokeArg
class PipArgs {
    var enter: Boolean = false
    var auto: Boolean = false
    var width: Int = 16
    var height: Int = 9
}

@InvokeArg
class MicArgs {
    var on: Boolean = false
}

@InvokeArg
class OverlayArgs {
    var on: Boolean = false
    var muted: Boolean = false
}

@InvokeArg
class OutputArgs {
    var id: Int = 0
}

@InvokeArg
class ScreenArgs {
    var width: Int = 1280
    var height: Int = 720
    var fps: Int = 15
    var channel: Channel? = null
}

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone"),
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
    ]
)
class NativePlugin(private val activity: Activity) : Plugin(activity) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /**
     * Android draws apps under the status and navigation bars (edge to edge), and the web view
     * doesn't always say how big those are. Hand the real sizes to the page as CSS variables
     * (--inset-top, --inset-bottom, --inset-left, --inset-right), including the keyboard, so
     * nothing hides behind the bars and the message box stays above the keyboard.
     */
    override fun load(webView: WebView) {
        super.load(webView)
        web = webView
        // Mustela has its own text size setting and a layout made for 100%; Android's font scale on top of
        // it made everything too big and cut off. Layout stays at 100%, the system scale just nudges the
        // page's base size (--font-scale) a little.
        val fontScale = activity.resources.configuration.fontScale
        webView.settings.textZoom = 100
        webView.post { webView.evaluateJavascript("document.documentElement.style.setProperty('--font-scale','${fontScale.coerceIn(0.85f, 1.3f)}')", null) }
        val density = activity.resources.displayMetrics.density
        ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val px = { n: Int -> "${(n / density).toInt()}px" }
            val js = "(function(s){s.setProperty('--inset-top','${px(bars.top)}');s.setProperty('--inset-bottom','${px(maxOf(bars.bottom, ime.bottom))}');" +
                "s.setProperty('--inset-left','${px(bars.left)}');s.setProperty('--inset-right','${px(bars.right)}');s.setProperty('--keyboard','${px(ime.bottom)}');})(document.documentElement.style)"
            (v as WebView).evaluateJavascript(js, null)
            insets
        }
        // Picture-in-picture: tell the page when the app goes in or out, so it shows just the call.
        var lastPip: Boolean? = null
        webView.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
            val inPip = Build.VERSION.SDK_INT >= 24 && activity.isInPictureInPictureMode
            if (inPip != lastPip) {
                lastPip = inPip
                (v as WebView).evaluateJavascript("document.documentElement.toggleAttribute('data-pip',$inPip);window.dispatchEvent(new CustomEvent('mustela:pip',{detail:$inPip}))", null)
            }
        }
        // A Stoat invite link this app was opened with.
        activity.intent?.data?.let { deliverLink(webView, it.toString()) }
        // The page loads after this; ask again once it's had time to start, so it gets the sizes too.
        for (delay in longArrayOf(300, 1200, 3000)) webView.postDelayed({ ViewCompat.requestApplyInsets(webView) }, delay)
    }

    private var web: WebView? = null

    /** A link opened while Mustela was already running (launchMode singleTask). */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val url = intent.data?.toString() ?: return
        web?.let { deliverLink(it, url) }
    }

    /**
     * Hands a link to the page: kept on window.__mustelaLink for a page that's still starting, and sent as a
     * "mustela:open-link" event for one that's running. Tried a few times, since the page may not be ready yet.
     */
    private fun deliverLink(webView: WebView, url: String) {
        val safe = url.replace("\\", "").replace("'", "%27").take(500)
        val js = "(function(u){if(window.__mustelaLinkDone===u)return;window.__mustelaLink=u;window.dispatchEvent(new CustomEvent('mustela:open-link',{detail:u}));})('$safe')"
        for (delay in longArrayOf(0, 1500, 4000)) webView.postDelayed({ webView.evaluateJavascript(js, null) }, delay)
    }

    /** Wallpaper-derived accent for "Use system colors" (Android 12+). */
    @Command
    fun accent(invoke: Invoke) {
        val ret = JSObject()
        if (Build.VERSION.SDK_INT >= 31) {
            val id = activity.resources.getIdentifier("system_accent1_500", "color", "android")
            if (id != 0) {
                val c = activity.resources.getColor(id, activity.theme) and 0xFFFFFF
                ret.put("hex", String.format("#%06x", c))
            }
        }
        invoke.resolve(ret)
    }

    @Command
    fun startCall(invoke: Invoke) {
        // The mic is mandatory. Notifications are not: without them the service still runs, just without a visible card.
        val aliases = ArrayList<String>()
        if (getPermissionState("microphone") != PermissionState.GRANTED) aliases.add("microphone")
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) aliases.add("notifications")
        if (aliases.isEmpty()) beginCall(invoke) else requestPermissionForAliases(aliases.toTypedArray(), invoke, "permissionsDone")
    }

    @PermissionCallback
    fun permissionsDone(invoke: Invoke) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) beginCall(invoke)
        else invoke.reject("Microphone permission is needed to join a call.")
    }

    private fun beginCall(invoke: Invoke) {
        val args = invoke.parseArgs(StartCallArgs::class.java)
        val ctx = activity.applicationContext
        scope.launch {
            try {
                CallService.start(ctx, args.channelName)
                CallEngine.start(ctx, args.url, args.token, args.channelId, args.channelName)
                invoke.resolve(state())
            } catch (t: Throwable) {
                CallService.stop(ctx)
                invoke.reject(t.message ?: "Couldn't join the call.")
            }
        }
    }

    @Command
    fun endCall(invoke: Invoke) {
        CallEngine.stop()
        CallService.stop(activity.applicationContext)
        invoke.resolve()
    }

    @Command
    fun setMic(invoke: Invoke) {
        val args = invoke.parseArgs(MicArgs::class.java)
        scope.launch {
            try {
                CallEngine.setMic(args.on)
                invoke.resolve(state())
            } catch (t: Throwable) {
                invoke.reject(t.message ?: "Couldn't change the microphone.")
            }
        }
    }

    @Command
    fun callState(invoke: Invoke) = invoke.resolve(state())

    /** Watching a stream: the phone may turn sideways (even with rotation locked, like video apps); off goes back to normal. */
    @Command
    fun landscape(invoke: Invoke) {
        val args = invoke.parseArgs(MicArgs::class.java)
        activity.runOnUiThread {
            activity.requestedOrientation = if (args.on) ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            invoke.resolve()
        }
    }

    /**
     * The phone's status bar and nav buttons: hidden while a stream fills the screen (a swipe from the edge
     * shows them for a moment, like video apps), shown the rest of the time.
     */
    @Command
    fun systemBars(invoke: Invoke) {
        val args = invoke.parseArgs(MicArgs::class.java)
        activity.runOnUiThread {
            val c = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
            if (args.on) c.show(WindowInsetsCompat.Type.systemBars())
            else {
                c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                c.hide(WindowInsetsCompat.Type.systemBars())
            }
            invoke.resolve()
        }
    }

    /* ---------- where call audio plays: earpiece, speaker, Bluetooth, a headset ---------- */

    private fun kindOf(type: Int): String = when (type) {
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, 26 /* BLE headset */, 27 /* BLE speaker */ -> "bluetooth"
        AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired"
        AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE -> "usb"
        else -> "other"
    }

    /** The outputs a call can use right now, and which one it's on. Android 12+ lists them all; older ones get earpiece or speaker. */
    @Command
    fun audioOutputs(invoke: Invoke) {
        val am = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val list = JSArray()
        if (Build.VERSION.SDK_INT >= 31) {
            val current = am.communicationDevice?.id
            for (d in am.availableCommunicationDevices) {
                val kind = kindOf(d.type)
                val name = when (kind) { "earpiece" -> "Phone"; "speaker" -> "Speaker"; else -> d.productName?.toString()?.takeIf { it.isNotBlank() } ?: kind.replaceFirstChar { it.uppercase() } }
                val o = JSObject(); o.put("id", d.id); o.put("kind", kind); o.put("name", name); o.put("selected", d.id == current)
                list.put(o)
            }
        } else {
            @Suppress("DEPRECATION") val speaker = am.isSpeakerphoneOn
            val e = JSObject(); e.put("id", 1); e.put("kind", "earpiece"); e.put("name", "Phone"); e.put("selected", !speaker); list.put(e)
            val s = JSObject(); s.put("id", 2); s.put("kind", "speaker"); s.put("name", "Speaker"); s.put("selected", speaker); list.put(s)
        }
        val ret = JSObject(); ret.put("outputs", list)
        invoke.resolve(ret)
    }

    @Command
    fun setAudioOutput(invoke: Invoke) {
        val args = invoke.parseArgs(OutputArgs::class.java)
        val am = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        activity.runOnUiThread {
            runCatching {
                if (Build.VERSION.SDK_INT >= 31) {
                    am.availableCommunicationDevices.firstOrNull { it.id == args.id }?.let { am.setCommunicationDevice(it) }
                } else {
                    @Suppress("DEPRECATION")
                    am.isSpeakerphoneOn = args.id == 2
                }
            }
            invoke.resolve()
        }
    }

    /** Back on the first screen: leave Mustela running in the background (calls keep going), like Discord. */
    @Command
    fun background(invoke: Invoke) {
        activity.runOnUiThread { activity.moveTaskToBack(true) }
        invoke.resolve()
    }

    /** Floating call window. Needs Android 8+; auto-enter on leaving the app needs Android 12+. */
    @Command
    fun pip(invoke: Invoke) {
        val args = invoke.parseArgs(PipArgs::class.java)
        val ret = JSObject()
        if (Build.VERSION.SDK_INT < 26 || !activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
            ret.put("supported", false); invoke.resolve(ret); return
        }
        activity.runOnUiThread {
            try {
                val w = args.width.coerceIn(1, 239); val h = args.height.coerceIn(1, 239)
                // Android only accepts shapes between 1:2.39 and 2.39:1.
                val ratio = if (w.toFloat() / h > 2.39f) Rational(239, 100) else if (h.toFloat() / w > 2.39f) Rational(100, 239) else Rational(w, h)
                val b = PictureInPictureParams.Builder().setAspectRatio(ratio)
                if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(args.auto).setSeamlessResizeEnabled(true)
                val params = b.build()
                activity.setPictureInPictureParams(params)
                if (args.enter) activity.enterPictureInPictureMode(params)
                ret.put("supported", true)
                invoke.resolve(ret)
            } catch (t: Throwable) {
                invoke.reject(t.message ?: "Picture-in-picture isn't available.")
            }
        }
    }

    private fun state(): JSObject {
        val o = JSObject()
        o.put("active", CallEngine.active())
        o.put("connected", CallEngine.connected())
        o.put("mic", CallEngine.micOn)
        o.put("channelId", CallEngine.channelId.takeIf { CallEngine.active() })
        o.put("channelName", CallEngine.channelName.takeIf { CallEngine.active() })
        o.put("participants", JSONArray(CallEngine.participants()))
        o.put("speaking", JSONArray(CallEngine.speaking()))
        o.put("error", CallEngine.error)
        return o
    }

    // The WebView pauses when the app goes to the background; the call must not. Nothing to do here on purpose:
    // CallEngine and CallService live outside this plugin's lifecycle.
    override fun onPause() {}

    /* ---------- call audio: the call volume, not media volume ---------- */

    /** In a call, Android treats Mustela as a call: the volume keys set call volume, and audio goes the call's way. */
    @Command
    fun callAudio(invoke: Invoke) {
        val args = invoke.parseArgs(MicArgs::class.java)
        val am = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        activity.runOnUiThread {
            runCatching {
                if (args.on) {
                    am.mode = AudioManager.MODE_IN_COMMUNICATION
                    activity.volumeControlStream = AudioManager.STREAM_VOICE_CALL
                } else {
                    am.mode = AudioManager.MODE_NORMAL
                    activity.volumeControlStream = AudioManager.USE_DEFAULT_STREAM_TYPE
                }
            }
            // The Web engine (video) gets the same background service as the voice engine: the call keeps
            // going when you leave the app or swipe it away, with a notification to come back or leave.
            if (!CallEngine.active()) runCatching {
                if (args.on) {
                    CallService.onLeave = { activity.runOnUiThread { val e = JSObject(); e.put("action", "leave"); trigger("bubble", e) } }
                    CallService.start(activity.applicationContext, "Voice call")
                } else {
                    CallService.onLeave = null
                    CallService.stop(activity.applicationContext)
                }
            }
            invoke.resolve()
        }
    }

    /* ---------- the voice bubble over other apps ---------- */

    private var overlayWanted = false
    private var overlayMuted = false

    /** The page says whether a call is on (so the bubble should appear when you leave the app) and if you're muted. */
    @Command
    fun setCallOverlay(invoke: Invoke) {
        val args = invoke.parseArgs(OverlayArgs::class.java)
        overlayWanted = args.on
        overlayMuted = args.muted
        activity.runOnUiThread {
            if (!args.on) Bubble.hide(activity) else Bubble.setMuted(args.muted)
            invoke.resolve()
        }
    }

    @Command
    fun overlayAllowed(invoke: Invoke) {
        val ret = JSObject()
        ret.put("allowed", Bubble.allowed(activity))
        invoke.resolve(ret)
    }

    /** Opens Android's "Display over other apps" page for Mustela; answers once you come back. */
    @Command
    fun requestOverlay(invoke: Invoke) {
        if (Bubble.allowed(activity)) { overlayAllowed(invoke); return }
        val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + activity.packageName))
        startActivityForResult(invoke, intent, "overlayResult")
    }

    @ActivityCallback
    fun overlayResult(invoke: Invoke, result: ActivityResult) {
        overlayAllowed(invoke)
    }

    private fun showBubble() {
        Bubble.show(activity, overlayMuted, onTap = {
            // Back to Mustela, where you left it.
            val i = activity.packageManager.getLaunchIntentForPackage(activity.packageName)
            if (i != null) {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                activity.startActivity(i)
            }
        }, onHold = {
            if (CallEngine.active()) {
                // The native engine mutes right here; the web engine is told through an event.
                scope.launch {
                    runCatching { CallEngine.setMic(!CallEngine.micOn) }
                    overlayMuted = !CallEngine.micOn
                    Bubble.setMuted(overlayMuted)
                }
            } else {
                overlayMuted = !overlayMuted
                Bubble.setMuted(overlayMuted)
                val e = JSObject()
                e.put("action", "mute")
                trigger("bubble", e)
            }
        })
    }

    // Leaving the app during a call shows the bubble; coming back hides it.
    override fun onStop() {
        if (overlayWanted && Bubble.allowed(activity)) activity.runOnUiThread { showBubble() }
    }

    override fun onResume() {
        activity.runOnUiThread { Bubble.hide(activity) }
    }

    /* ---------- screen share ---------- */

    private var screenArgs: ScreenArgs? = null

    /** Asks Android for permission to capture the screen (its own prompt), then starts the capture service. */
    @Command
    fun screenStart(invoke: Invoke) {
        val args = invoke.parseArgs(ScreenArgs::class.java)
        if (args.channel == null) { invoke.reject("No channel for the frames."); return }
        if (Build.VERSION.SDK_INT < 21) { invoke.reject("Screen sharing needs Android 5 or newer."); return }
        screenArgs = args
        val mpm = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(invoke, mpm.createScreenCaptureIntent(), "screenConsent")
    }

    @ActivityCallback
    fun screenConsent(invoke: Invoke, result: ActivityResult) {
        val args = screenArgs
        val ch = args?.channel
        val data = result.data
        if (args == null || ch == null || result.resultCode != Activity.RESULT_OK || data == null) {
            invoke.reject("cancelled")
            return
        }
        ScreenService.listener = object : ScreenService.Listener {
            override fun onFrame(jpegBase64: String) {
                val m = JSObject()
                m.put("f", jpegBase64)
                ch.send(m)
            }
            override fun onEnded() {
                val m = JSObject()
                m.put("end", true)
                ch.send(m)
            }
        }
        ScreenService.start(activity, result.resultCode, data, args.width, args.height, args.fps)
        invoke.resolve()
    }

    /** The page drew a frame: the next one may come. */
    @Command
    fun screenAck(invoke: Invoke) {
        ScreenService.inflight.updateAndGet { n -> if (n > 0) n - 1 else 0 }
        invoke.resolve()
    }

    @Command
    fun screenStop(invoke: Invoke) {
        ScreenService.listener = null
        ScreenService.stop(activity)
        invoke.resolve()
    }
}
