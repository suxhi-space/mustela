package app.mustela.nativecall

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.SystemClock
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicInteger

/**
 * Screen share on Android. Android only allows screen capture from a foreground service of type
 * "mediaProjection", started after you agree in the system's prompt. Frames are scaled down, compressed
 * to JPEG and handed to the page, which sends them into the call like the desktop apps' own capture
 * (src/lib/voice/capture.ts). At most two frames wait for the page at once; extra ones are skipped.
 */
class ScreenService : Service() {
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var thread: HandlerThread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null || intent.action == ACTION_STOP) { finish(); return START_NOT_STICKY }
        val n = notification()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        else startForeground(NOTIFICATION_ID, n)

        val code = intent.getIntExtra(EXTRA_CODE, Activity.RESULT_CANCELED)
        @Suppress("DEPRECATION")
        val data: Intent? = intent.getParcelableExtra(EXTRA_DATA)
        if (code != Activity.RESULT_OK || data == null) { listener?.onEnded(); finish(); return START_NOT_STICKY }
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val p = mpm.getMediaProjection(code, data)
        if (p == null) { listener?.onEnded(); finish(); return START_NOT_STICKY }
        projection = p
        begin(p, intent.getIntExtra(EXTRA_W, 1280), intent.getIntExtra(EXTRA_H, 720), intent.getIntExtra(EXTRA_FPS, 15))
        return START_NOT_STICKY
    }

    private fun begin(p: MediaProjection, maxW: Int, maxH: Int, fps: Int) {
        val metrics = resources.displayMetrics
        // The phone's screen, scaled to fit the chosen size (even numbers, as video encoders want).
        val scale = minOf(1f, minOf(maxW.toFloat() / metrics.widthPixels, maxH.toFloat() / metrics.heightPixels))
        val w = ((metrics.widthPixels * scale).toInt() / 2) * 2
        val h = ((metrics.heightPixels * scale).toInt() / 2) * 2
        val t = HandlerThread("mustela-screen").also { it.start() }
        thread = t
        val handler = Handler(t.looper)
        val r = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
        reader = r
        val every = 1000L / fps.coerceIn(1, 30)
        var last = 0L
        r.setOnImageAvailableListener({ ir ->
            val img = runCatching { ir.acquireLatestImage() }.getOrNull() ?: return@setOnImageAvailableListener
            try {
                val now = SystemClock.uptimeMillis()
                if (now - last < every || inflight.get() >= 2) return@setOnImageAvailableListener
                last = now
                val plane = img.planes[0]
                val rowPx = plane.rowStride / plane.pixelStride
                // Rows can be padded: decode the padded width, then cut it to the real one.
                val padded = Bitmap.createBitmap(rowPx, h, Bitmap.Config.ARGB_8888)
                padded.copyPixelsFromBuffer(plane.buffer)
                val frame = if (rowPx != w) Bitmap.createBitmap(padded, 0, 0, w, h) else padded
                val out = ByteArrayOutputStream()
                frame.compress(Bitmap.CompressFormat.JPEG, 72, out)
                if (frame !== padded) frame.recycle()
                padded.recycle()
                inflight.incrementAndGet()
                listener?.onFrame(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
            } catch (_: Throwable) {
                // A bad frame: skip it.
            } finally {
                img.close()
            }
        }, handler)
        // Android 14+ wants to hear about the capture stopping (from the system's own "stop sharing").
        p.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() { listener?.onEnded(); finish() }
        }, handler)
        display = p.createVirtualDisplay("Mustela screen share", w, h, metrics.densityDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, handler)
    }

    private fun finish() {
        runCatching { display?.release() }
        runCatching { reader?.close() }
        runCatching { projection?.stop() }
        runCatching { thread?.quitSafely() }
        display = null; reader = null; projection = null; thread = null
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        stopSelf()
    }

    override fun onDestroy() {
        runCatching { display?.release() }
        runCatching { reader?.close() }
        runCatching { projection?.stop() }
        runCatching { thread?.quitSafely() }
        super.onDestroy()
    }

    private fun notification(): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Screen sharing", NotificationManager.IMPORTANCE_LOW))
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_slideshow)
            .setContentTitle("Sharing your screen")
            .setContentText("Mustela is sharing your screen in a call.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    interface Listener { fun onFrame(jpegBase64: String); fun onEnded() }

    companion object {
        const val ACTION_STOP = "app.mustela.nativecall.SCREEN_STOP"
        private const val EXTRA_CODE = "code"
        private const val EXTRA_DATA = "data"
        private const val EXTRA_W = "w"
        private const val EXTRA_H = "h"
        private const val EXTRA_FPS = "fps"
        private const val CHANNEL_ID = "mustela_screen"
        private const val NOTIFICATION_ID = 4712

        /** Frames sent to the page that it hasn't drawn yet. */
        val inflight = AtomicInteger(0)
        @Volatile var listener: Listener? = null

        fun start(ctx: Context, code: Int, data: Intent, w: Int, h: Int, fps: Int) {
            inflight.set(0)
            val i = Intent(ctx, ScreenService::class.java)
                .putExtra(EXTRA_CODE, code).putExtra(EXTRA_DATA, data)
                .putExtra(EXTRA_W, w).putExtra(EXTRA_H, h).putExtra(EXTRA_FPS, fps)
            ContextCompat.startForegroundService(ctx, i)
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, ScreenService::class.java).setAction(ACTION_STOP))
        }
    }
}
