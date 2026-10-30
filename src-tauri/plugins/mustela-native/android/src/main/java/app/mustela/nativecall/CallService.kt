package app.mustela.nativecall

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service (type "microphone") that keeps the process, and so the
 * call in [CallEngine], alive while Mustela is in the background or has been
 * swiped out of recents. It owns no audio itself; it exists so Android
 * treats the app as "in a call" and doesn't kill it.
 */
class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            onLeave?.invoke() // a call in the web view (the Web engine): the page leaves it
            CallEngine.stop()
            stopForegroundCompat()
            stopSelf()
            return START_NOT_STICKY
        }
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: CallEngine.channelName ?: "Voice call"
        val n = buildNotification(title)
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
        // NOT_STICKY: if the system kills the process the call is gone anyway; restarting an empty service would be misleading.
        return START_NOT_STICKY
    }

    /** Called when the user swipes the app away. Deliberately does nothing: the call continues. */
    override fun onTaskRemoved(rootIntent: Intent?) {}

    override fun onDestroy() {
        CallEngine.stop()
        super.onDestroy()
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
