package app.mustela.nativecall

import android.Manifest
import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.os.Build
import android.util.Rational
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
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

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone"),
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
    ]
)
class NativePlugin(private val activity: Activity) : Plugin(activity) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

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
}
