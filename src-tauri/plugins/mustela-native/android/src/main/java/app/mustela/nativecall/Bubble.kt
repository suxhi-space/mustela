package app.mustela.nativecall

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import kotlin.math.abs

/**
 * The voice bubble, like Discord's mobile call overlay: a small circle over other apps while you're in a
 * call and Mustela is in the background. Drag it anywhere; tap it to come back to Mustela; hold it to
 * mute or unmute. It turns red while you're muted. Needs "Display over other apps" (asked for in the app).
 */
object Bubble {
    private var view: FrameLayout? = null
    private var icon: ImageView? = null
    private var params: WindowManager.LayoutParams? = null
    private var muted = false

    fun allowed(ctx: Context): Boolean = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx)

    fun showing() = view != null

    @SuppressLint("ClickableViewAccessibility")
    fun show(ctx: Context, isMuted: Boolean, onTap: () -> Unit, onHold: () -> Unit) {
        if (view != null) { setMuted(isMuted); return }
        if (!allowed(ctx)) return
        val app = ctx.applicationContext
        val wm = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val density = app.resources.displayMetrics.density
        val size = (60 * density).toInt()

        val circle = FrameLayout(app)
        val img = ImageView(app)
        img.setImageResource(android.R.drawable.ic_btn_speak_now)
        img.setColorFilter(0xFFFFFFFF.toInt())
        val pad = (14 * density).toInt()
        img.setPadding(pad, pad, pad, pad)
        circle.addView(img, FrameLayout.LayoutParams(size, size))
        circle.elevation = 8 * density
        circle.contentDescription = "Mustela call. Tap to open, hold to mute."

        @Suppress("DEPRECATION")
        val type = if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE
        val lp = WindowManager.LayoutParams(
            size, size, type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        )
        lp.gravity = Gravity.TOP or Gravity.START
        lp.x = app.resources.displayMetrics.widthPixels - size - (12 * density).toInt()
        lp.y = (app.resources.displayMetrics.heightPixels * 0.3f).toInt()

        // Drag to move; a short touch that barely moved is a tap; holding still is "mute".
        val handler = Handler(Looper.getMainLooper())
        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0
        var moved = false; var held = false
        val hold = Runnable { held = true; circle.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS); onHold() }
        circle.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = lp.x; startY = lp.y
                    moved = false; held = false
                    handler.postDelayed(hold, 550)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX; val dy = e.rawY - downY
                    if (!moved && (abs(dx) > 12 * density || abs(dy) > 12 * density)) { moved = true; handler.removeCallbacks(hold) }
                    if (moved) {
                        lp.x = startX + dx.toInt(); lp.y = startY + dy.toInt()
                        runCatching { wm.updateViewLayout(v, lp) }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    handler.removeCallbacks(hold)
                    if (!moved && !held) onTap()
                    true
                }
                MotionEvent.ACTION_CANCEL -> { handler.removeCallbacks(hold); true }
                else -> false
            }
        }

        view = circle; icon = img; params = lp
        setMuted(isMuted)
        runCatching { wm.addView(circle, lp) }.onFailure { view = null; icon = null; params = null }
    }

    fun setMuted(m: Boolean) {
        muted = m
        val v = view ?: return
        val bg = GradientDrawable()
        bg.shape = GradientDrawable.OVAL
        bg.setColor(if (m) 0xFFD83A3A.toInt() else 0xFF2F8F5B.toInt())
        bg.setStroke((2 * v.resources.displayMetrics.density).toInt(), 0x66FFFFFF)
        v.background = bg
    }

    fun hide(ctx: Context) {
        val v = view ?: return
        view = null; icon = null; params = null
        val wm = ctx.applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        runCatching { wm.removeView(v) }
    }
}
