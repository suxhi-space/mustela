package app.mustela.nativecall

import android.Manifest
import android.app.Activity
import android.app.PictureInPictureParams
import android.content.ComponentCallbacks
import android.content.Context
import android.content.res.Configuration
import android.graphics.Rect
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.AudioDeviceInfo
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import androidx.core.content.ContextCompat
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
class WatchArgs {
    var on: Boolean = false
    var profile: String? = null
}

@InvokeArg
class AliveArgs {
    var alive: Boolean = false
}

@InvokeArg
class ClearArgs {
    var channel: String = ""
}

@InvokeArg
class InstallArgs {
    var path: String = ""
}

@InvokeArg
class MediaArgs {
    var url: String = ""
    var name: String = "file"
    var share: Boolean = false
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
        lockPageScale(webView)
        activity.runOnUiThread { clearBarScrims() }
        webView.post { webView.evaluateJavascript("document.documentElement.style.setProperty('--font-scale','${fontScale.coerceIn(0.85f, 1.3f)}')", null) }
        val density = activity.resources.displayMetrics.density
        ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
            val status = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
            if (hideStatus && status > 0) v.post { applyStatusBar() }
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            // Bottom: nav buttons or a pinned taskbar take their real height (they're "tappable"); with gesture
            // navigation only a slim strip for the handle is kept, not the whole gesture area (tablets left a big gap).
            val tappable = insets.getInsets(WindowInsetsCompat.Type.tappableElement()).bottom
            val bottom = if (tappable > 0) tappable else minOf(bars.bottom, (18 * density).toInt())
            val top = if (hideStatus) 0 else bars.top
            val px = { n: Int -> "${(n / density).toInt()}px" }
            val js = "(function(s){s.setProperty('--inset-top','${px(top)}');s.setProperty('--inset-bottom','${px(maxOf(bottom, ime.bottom))}');" +
                "s.setProperty('--inset-left','${px(bars.left)}');s.setProperty('--inset-right','${px(bars.right)}');s.setProperty('--keyboard','${px(ime.bottom)}');})(document.documentElement.style)"
            (v as WebView).evaluateJavascript(js, null)
            insets
        }
        // Picture-in-picture: tell the page when the app goes in or out, so it shows just the call. Checked on every
        // resize and again just after (Android can resize before it says it's in picture-in-picture), and on pause/resume.
        webView.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> reportPip(); webView.postDelayed({ reportPip() }, 250) }
        // A Stoat invite link this app was opened with.
        activity.intent?.data?.let { deliverLink(webView, it.toString()) }
        // The page loads after this; ask again once it's had time to start, so it gets the sizes too.
        for (delay in longArrayOf(300, 1200, 3000)) webView.postDelayed({ ViewCompat.requestApplyInsets(webView) }, delay)
        // Gesture navigation and the 3-button bar change the insets without restarting the app.
        activity.application.registerComponentCallbacks(object : ComponentCallbacks {
            override fun onConfigurationChanged(newConfig: Configuration) { refreshChrome() }
            override fun onLowMemory() {}
        })
    }

    /** Re-read the bars and the system font size. Called when the app returns or the navigation mode changes. */
    private fun refreshChrome() {
        val webView = web ?: return
        val fontScale = activity.resources.configuration.fontScale
        // Coming back from the home screen or picture-in-picture makes Android zoom the page again on
        // top of the size already set. Put text back to 100% a few times, after Android has had its turn.
        webView.post {
            lockPageScale(webView)
            webView.evaluateJavascript("document.documentElement.style.setProperty('--font-scale','${fontScale.coerceIn(0.85f, 1.3f)}')", null)
            webView.evaluateJavascript("window.__mustelaRefit&&window.__mustelaRefit()", null)
            ViewCompat.requestApplyInsets(webView)
            if (hideStatus) applyStatusBar()
        }
        for (delay in longArrayOf(200, 800)) webView.postDelayed({ refit() }, delay)
    }

    /**
     * Stop Android's own zoom. Mustela's App size is the only scale. (No setInitialScale: on some tablets that put
     * the page in screen pixels while the bar sizes stayed in dp, so the app slid under the status and nav bars.)
     */
    private fun lockPageScale(webView: WebView) {
        webView.settings.textZoom = 100
        webView.settings.setSupportZoom(false)
        webView.settings.builtInZoomControls = false
        webView.settings.displayZoomControls = false
        // No "font boosting" (Android enlarging text it thinks is too small, which made the app come back fat after
        // the home screen or picture-in-picture) and no zoomed-out overview layout: the page is sized by its own rules.
        @Suppress("DEPRECATION")
        webView.settings.layoutAlgorithm = android.webkit.WebSettings.LayoutAlgorithm.NORMAL
        webView.settings.loadWithOverviewMode = false
    }

    /** The app is drawn behind the status and navigation bars: no grey strip from Android behind the gesture bar. */
    private fun clearBarScrims() {
        val w = activity.window
        if (Build.VERSION.SDK_INT >= 29) { w.isNavigationBarContrastEnforced = false; w.isStatusBarContrastEnforced = false }
        @Suppress("DEPRECATION")
        if (Build.VERSION.SDK_INT < 35) w.navigationBarColor = android.graphics.Color.TRANSPARENT
    }

    private fun refit() {
        val webView = web ?: return
        lockPageScale(webView)
        webView.evaluateJavascript("window.__mustelaRefit&&window.__mustelaRefit()", null)
    }

    private var web: WebView? = null
    /** Set while a stream's controls are hidden. The page shows the status bar again with Mustela's own buttons. */
    private var hideStatus = false

    private fun applyStatusBar() {
        val c = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        if (hideStatus) {
            c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            c.hide(WindowInsetsCompat.Type.statusBars())
        } else c.show(WindowInsetsCompat.Type.statusBars())
    }

    private var lastPip: Boolean? = null
    /**
     * Tells the page whether the app is in picture-in-picture. Leaving it says how: "expanded" when you tapped the
     * window to open the app (the page then shows the call), not when you closed it (opening Mustela later, from
     * recents or anywhere else, goes back to where you were).
     */
    private fun reportPip() {
        val view = web ?: return
        val inPip = Build.VERSION.SDK_INT >= 24 && activity.isInPictureInPictureMode
        if (inPip == lastPip) return
        val was = lastPip
        lastPip = inPip
        val expanded = was == true && !inPip &&
            (activity as? androidx.lifecycle.LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED) == true
        view.evaluateJavascript("document.documentElement.toggleAttribute('data-pip',$inPip);window.dispatchEvent(new CustomEvent('mustela:pip',{detail:{pip:$inPip,expanded:$expanded}}))", null)
        if (!inPip) view.post { refit() }
    }

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
     * The phone's status bar. Full screen inside the app hides it until the page asks for it back.
     * A swipe from the top edge shows it for a moment. The navigation bar stays.
     */
    @Command
    fun systemBars(invoke: Invoke) {
        val args = invoke.parseArgs(MicArgs::class.java)
        activity.runOnUiThread {
            // on: the bars are visible. Full screen asks for them off, which hides the status bar only.
            hideStatus = !args.on
            applyStatusBar()
            ViewCompat.requestApplyInsets(web ?: activity.window.decorView)
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
                // A small hint so a tablet can shrink the window as far as a phone (about 108dp).
                val shortSide = (108 * activity.resources.displayMetrics.density).toInt()
                val longSide = shortSide * 16 / 9
                b.setSourceRectHint(Rect(0, 0, if (w >= h) longSide else shortSide, shortSide))
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
    override fun onPause() { keepPageRunning(); activity.runOnUiThread { reportPip() } }

    /** In a call: the page runs the call, so it mustn't be paused or slowed when you leave the app or lock the phone. */
    private var inCall = false
    private fun keepPageRunning() {
        if (!inCall) return
        web?.post { runCatching { web?.onResume(); web?.resumeTimers() } }
    }

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
            // The page's process keeps its priority while hidden, so Android doesn't slow or drop it mid-call.
            inCall = args.on
            if (Build.VERSION.SDK_INT >= 26) runCatching { web?.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, !args.on) }
            // The Web engine (video) gets the same background service as the voice engine: the call keeps
            // going when you leave the app or swipe it away, with a notification to come back or leave.
            // Only once the microphone is allowed: Android stops any app that starts a microphone service without it
            // (joining calls into call mode before the permission prompt, so this runs again once you're in).
            val micAllowed = ContextCompat.checkSelfPermission(activity, android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED
            if (!CallEngine.active() && (micAllowed || !args.on)) runCatching {
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
        keepPageRunning()
        if (overlayWanted && Bubble.allowed(activity)) activity.runOnUiThread { showBubble() }
    }

    override fun onResume() {
        activity.runOnUiThread { Bubble.hide(activity); reportPip(); refreshChrome() }
        // Back from the background: the page runs again (it was paused when it let go, see watchAlive).
        if (pagePaused) { pagePaused = false; web?.post { runCatching { web?.onResume(); web?.resumeTimers() } } }
    }

    /* ---------- notifications while Mustela is closed (MessageWatch.kt) ---------- */

    private var pagePaused = false

    /** Turns checking on with the page's profile (session, channel settings, names), or off (forgets the session). */
    @Command
    fun watch(invoke: Invoke) {
        val args = invoke.parseArgs(WatchArgs::class.java)
        MessageWatch.configure(activity.applicationContext, args.on, args.profile)
        invoke.resolve()
    }

    /**
     * The page is connected and notifying (true, every ~20 s), or it disconnected after a while in the background
     * (false): checking takes over, and the page is paused so it costs nothing until you come back.
     */
    @Command
    fun watchAlive(invoke: Invoke) {
        val args = invoke.parseArgs(AliveArgs::class.java)
        MessageWatch.alive(activity.applicationContext, args.alive)
        if (!args.alive && !inCall) { pagePaused = true; web?.post { runCatching { web?.onPause(); web?.pauseTimers() } } }
        invoke.resolve()
    }

    /** You opened this conversation in the app: its notification goes. */
    @Command
    fun watchClear(invoke: Invoke) {
        val args = invoke.parseArgs(ClearArgs::class.java)
        if (args.channel.isNotEmpty()) MessageWatch.clear(activity.applicationContext, args.channel)
        invoke.resolve()
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

    /* ---------- pictures and videos from the gallery: save or share ---------- */

    @Command
    fun mediaFile(invoke: Invoke) {
        val args = invoke.parseArgs(MediaArgs::class.java)
        val uri = Uri.parse(args.url)
        if (uri.scheme != "https" && uri.scheme != "http") { invoke.reject("not a web link"); return }
        try {
            if (args.share) {
                val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, args.url) }
                activity.startActivity(Intent.createChooser(send, null))
            } else {
                // Downloads, with the phone's own "download complete" notification.
                val name = args.name.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(120).ifBlank { "file" }
                val req = android.app.DownloadManager.Request(uri)
                    .setTitle(name)
                    .setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, name)
                (activity.getSystemService(Context.DOWNLOAD_SERVICE) as android.app.DownloadManager).enqueue(req)
            }
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(e.message ?: "couldn't save")
        }
    }

    /**
     * Installs an update Mustela downloaded (and checked against GitHub's checksum) into its own folder. The file
     * is streamed into Android's package installer and deleted straight away, so no APKs pile up in storage. Android
     * asks the person to confirm (and, the first time, to allow Mustela to install apps). Only an APK signed with
     * the same key as this one can replace it.
     */
    @Command
    fun installApk(invoke: Invoke) {
        val args = invoke.parseArgs(InstallArgs::class.java)
        val file = java.io.File(args.path)
        val home = java.io.File(activity.applicationInfo.dataDir).canonicalPath
        if (!file.canonicalPath.startsWith("$home/") || !file.name.endsWith(".apk") || !file.isFile) { invoke.reject("not an update file"); return }
        scope.launch(Dispatchers.IO) {
            try {
                val installer = activity.packageManager.packageInstaller
                val params = android.content.pm.PackageInstaller.SessionParams(android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL)
                params.setAppPackageName(activity.packageName)
                if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(android.content.pm.PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                val id = installer.createSession(params)
                installer.openSession(id).use { session ->
                    file.inputStream().use { input ->
                        session.openWrite("mustela.apk", 0, file.length()).use { out -> input.copyTo(out); session.fsync(out) }
                    }
                    file.delete()
                    val action = "${activity.packageName}.MUSTELA_INSTALL_STATUS"
                    registerInstallStatus(action)
                    val flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) android.app.PendingIntent.FLAG_MUTABLE else 0)
                    val pending = android.app.PendingIntent.getBroadcast(activity, id, Intent(action).setPackage(activity.packageName), flags)
                    session.commit(pending.intentSender)
                }
                invoke.resolve()
            } catch (e: Exception) {
                file.delete()
                invoke.reject(e.message ?: "couldn't install the update")
            }
        }
    }

    private var installStatus: android.content.BroadcastReceiver? = null

    /** The installer's answers: it needs the person to confirm (shown here), or it failed (said in a toast). */
    private fun registerInstallStatus(action: String) {
        if (installStatus != null) return
        val receiver = object : android.content.BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.getIntExtra(android.content.pm.PackageInstaller.EXTRA_STATUS, -999)) {
                    android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                        @Suppress("DEPRECATION")
                        val confirm: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                        confirm?.let { activity.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    }
                    android.content.pm.PackageInstaller.STATUS_SUCCESS -> {}
                    else -> {
                        val why = intent.getStringExtra(android.content.pm.PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "unknown reason"
                        activity.runOnUiThread { android.widget.Toast.makeText(activity, "The update wasn't installed ($why).", android.widget.Toast.LENGTH_LONG).show() }
                    }
                }
            }
        }
        ContextCompat.registerReceiver(activity, receiver, android.content.IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED)
        installStatus = receiver
    }
}
