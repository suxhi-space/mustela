package app.mustela.nativecall

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

/**
 * Taking a photo or a video from the + card with the phone's own camera app.
 *
 * The camera writes straight into Mustela's private cache (never your gallery), and the file is deleted once it's
 * read. Android sometimes closes Mustela while the camera is in front (it needs the memory): what was being taken is
 * remembered here, so when Mustela starts again it can still pick the photo up and put it back on the chat it was for.
 */
object Camera {
    private const val PREFS = "mustela.camera"
    /** Same size cap as photos picked from the gallery (Photos.read). */
    private const val MAX_BYTES = 25 * 1024 * 1024

    private fun dir(ctx: Context): File = File(ctx.cacheDir, "camera").apply { mkdirs() }

    /** A new, empty file for the camera to write into, remembered in case Mustela is closed meanwhile. */
    fun newFile(ctx: Context, video: Boolean): File {
        // Anything left from an earlier capture that never got picked up goes first.
        dir(ctx).listFiles()?.forEach { runCatching { it.delete() } }
        val f = File(dir(ctx), (if (video) "VID_" else "IMG_") + System.currentTimeMillis() + if (video) ".mp4" else ".jpg")
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("path", f.absolutePath).putBoolean("video", video).apply()
        return f
    }

    /** The system camera, told to save into that file (and nowhere else). */
    fun intent(ctx: Context, file: File, video: Boolean): Intent {
        val uri: Uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".mustela.files", file)
        return Intent(if (video) MediaStore.ACTION_VIDEO_CAPTURE else MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            // Some camera apps only get write access through the clip data, not the extra.
            clipData = ClipData.newRawUri("", uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    /**
     * What the camera took, as data to attach (then deleted), or null if nothing was taken. Clears the memory of it
     * either way, so it's only ever picked up once.
     */
    fun take(ctx: Context): JSONObject? {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val path = prefs.getString("path", null)
        val video = prefs.getBoolean("video", false)
        prefs.edit().clear().apply()
        if (path == null) return null
        val f = File(path)
        // Only ever a file in Mustela's own camera folder.
        if (f.parentFile?.canonicalPath != dir(ctx).canonicalPath) return null
        try {
            if (!f.exists() || f.length() == 0L || f.length() > MAX_BYTES) return null
            val bytes = f.readBytes()
            return JSONObject()
                .put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
                .put("mime", if (video) "video/mp4" else "image/jpeg")
                .put("name", f.name)
        } catch (_: Throwable) {
            return null
        } finally {
            runCatching { f.delete() }
        }
    }

    /** Cancelled: forget it and delete the empty file. */
    fun clear(ctx: Context) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString("path", null)?.let { p -> runCatching { File(p).delete() } }
        prefs.edit().clear().apply()
    }

    /** Whether a photo or video is waiting to be picked up (Mustela was closed while the camera was open). */
    fun waiting(ctx: Context): Boolean {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("path", null) ?: return false
        val f = File(p)
        return f.exists() && f.length() > 0
    }
}
