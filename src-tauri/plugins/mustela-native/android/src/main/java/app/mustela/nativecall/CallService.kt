package app.mustela.nativecall

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service (type "microphone") that keeps the process, and so the
 * call, alive while Mustela is in the background or the screen is off, and
 * shows the "In voice call" notification with Leave. It owns no audio itself;
 * it exists so Android treats the app as "in a call" and doesn't kill it, and it
 * keeps the phone awake enough for the call (see holdAwake).
 */
class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            onLeave?.invoke() // a call in the web view (the Web engine): the page leaves it
            CallEngine.stop()
            letSleep()
            stopForegroundCompat()
            stopSelf()
            return START_NOT_STICKY
        }
        holdAwake()
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: CallEngine.channelName ?: "Voice call"
        val n = buildNotification(title)
        // Android refuses (and stops the whole app) when a microphone service starts without the permission or from
        // the background: never let that take Mustela down, the call just goes on without the notification.
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            else startForeground(NOTIFICATION_ID, n)
        } catch (e: Exception) {
            letSleep()
            stopSelf()
            return START_NOT_STICKY
        }
        // NOT_STICKY: if the system kills the process the call is gone anyway; restarting an empty service would be misleading.
        return START_NOT_STICKY
    }

    /** Called when the user swipes the app away. Deliberately does nothing: the call continues. */
    override fun onTaskRemoved(rootIntent: Intent?) {}

    override fun onDestroy() {
        CallEngine.stop()
        letSleep()
        super.onDestroy()
    }

    /*
     * With the screen off the phone sleeps: the CPU stops and Wi-Fi idles, and the call's connection quietly dies
     * (you'd look "in the call" while nobody hears you). A call holds both awake, like any calling app, until it ends.
     */
    private var cpu: PowerManager.WakeLock? = null
    private var wifi: WifiManager.WifiLock? = null

    private fun holdAwake() {
        if (cpu == null) runCatching {
            cpu = (getSystemService(Context.POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mustela:call").apply { setReferenceCounted(false); acquire(6 * 60 * 60 * 1000L) }
        }
        if (wifi == null) runCatching {
            val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else @Suppress("DEPRECATION") WifiManager.WIFI_MODE_FULL_HIGH_PERF
            wifi = (applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
                .createWifiLock(mode, "mustela:call").apply { setReferenceCounted(false); acquire() }
        }
    }

    private fun letSleep() {
        runCatching { cpu?.takeIf { it.isHeld }?.release() }
        runCatching { wifi?.takeIf { it.isHeld }?.release() }
        cpu = null; wifi = null
    }

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
    }

    private fun buildNotification(title: String): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Voice calls", NotificationManager.IMPORTANCE_LOW))
        }
        val open = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val openPi = open?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
        val leavePi = PendingIntent.getService(
            this, 1, Intent(this, CallService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(resources.getIdentifier("ic_notification", "drawable", packageName).takeIf { it != 0 } ?: android.R.drawable.stat_sys_phone_call) // icons/notification.png, if you added one
            .setContentTitle("In voice call")
            .setContentText(title)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openPi)
            .addAction(0, "Leave", leavePi)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    companion object {
        const val ACTION_STOP = "app.mustela.nativecall.STOP"
        /** Set by the plugin: "Leave" in the notification ends a call the page is running. */
        @Volatile var onLeave: (() -> Unit)? = null
        const val EXTRA_TITLE = "title"
        private const val CHANNEL_ID = "mustela_call"
        private const val NOTIFICATION_ID = 4711

        fun start(ctx: Context, title: String) {
            ContextCompat.startForegroundService(ctx, Intent(ctx, CallService::class.java).putExtra(EXTRA_TITLE, title))
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, CallService::class.java).setAction(ACTION_STOP))
        }
    }
}
