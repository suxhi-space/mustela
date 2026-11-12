package app.mustela.nativecall

import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import android.util.Size
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Your latest photos and videos for the + card, like Discord's: small thumbnails to pick from, and the chosen file
 * read only when you pick it (nothing leaves the phone until then). Needs Android's photo permission ("Allow all" or,
 * on Android 14 and later, just the photos you select).
 */
object Photos {
    private val PERMS: Array<String> get() = when {
        Build.VERSION.SDK_INT >= 34 -> arrayOf(android.Manifest.permission.READ_MEDIA_IMAGES, android.Manifest.permission.READ_MEDIA_VIDEO, android.Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
        Build.VERSION.SDK_INT >= 33 -> arrayOf(android.Manifest.permission.READ_MEDIA_IMAGES, android.Manifest.permission.READ_MEDIA_VIDEO)
        else -> arrayOf(android.Manifest.permission.READ_EXTERNAL_STORAGE)
    }
    fun permissions(): Array<String> = PERMS

    /** Some access at all (all photos, or the ones you picked on Android 14+). */
    fun allowed(ctx: Context): Boolean = PERMS.any { ctx.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    class Page(val items: JSONArray, val next: Int)

    /**
     * `limit` photos and videos from `offset` on, newest first, each with a small thumbnail as a data URL; `next` is
     * where the following page starts (-1 at the end).
     */
    fun recent(ctx: Context, limit: Int, offset: Int = 0): Page {
        val out = JSONArray()
        var next = -1
        if (!allowed(ctx)) return Page(out, -1)
        val files = MediaStore.Files.getContentUri("external")
        val cols = arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.MEDIA_TYPE, MediaStore.Files.FileColumns.MIME_TYPE,
            MediaStore.Files.FileColumns.DISPLAY_NAME, MediaStore.Files.FileColumns.SIZE, MediaStore.Files.FileColumns.DATE_ADDED)
        val where = "${MediaStore.Files.FileColumns.MEDIA_TYPE} IN (${MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE}, ${MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO})"
        val order = "${MediaStore.Files.FileColumns.DATE_ADDED} DESC"
        runCatching {
            ctx.contentResolver.query(files, cols, where, null, order)?.use { c ->
                if (offset > 0 && !c.moveToPosition(offset - 1)) return@use
                while (out.length() < limit.coerceIn(1, 60) && c.moveToNext()) {
                    val id = c.getLong(0)
                    val video = c.getInt(1) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
                    val uri = ContentUris.withAppendedId(if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
                    val thumb = thumbnail(ctx, uri, id, video) ?: continue
                    out.put(JSONObject().put("uri", uri.toString()).put("thumb", thumb).put("mime", c.getString(2) ?: if (video) "video/mp4" else "image/jpeg")
                        .put("name", c.getString(3) ?: "photo").put("size", c.getLong(4)).put("video", video)
                        // When it was added (ms), for the + card's "by date" view and the date on its scroll handle.
                        .put("date", c.getLong(5) * 1000))
                }
                if (!c.isAfterLast && !c.isLast && c.position >= 0) next = c.position + 1
            }
        }
        return Page(out, next)
    }

    private fun thumbnail(ctx: Context, uri: Uri, id: Long, video: Boolean): String? {
        val bmp: Bitmap = runCatching {
            if (Build.VERSION.SDK_INT >= 29) ctx.contentResolver.loadThumbnail(uri, Size(256, 256), null)
            else if (video) @Suppress("DEPRECATION") MediaStore.Video.Thumbnails.getThumbnail(ctx.contentResolver, id, MediaStore.Video.Thumbnails.MINI_KIND, null)
            else @Suppress("DEPRECATION") MediaStore.Images.Thumbnails.getThumbnail(ctx.contentResolver, id, MediaStore.Images.Thumbnails.MINI_KIND, null)
        }.getOrNull() ?: return null
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 72, out)
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    /** The picked photo or video itself (up to 25 MB), to attach to the message. */
    fun read(ctx: Context, uri: String): JSONObject? {
        val u = Uri.parse(uri)
        if (u.scheme != "content" || u.authority != MediaStore.AUTHORITY) return null
        val bytes = runCatching { ctx.contentResolver.openInputStream(u)?.use { s ->
            val buf = ByteArrayOutputStream(); val chunk = ByteArray(64 * 1024); var total = 0
            while (true) { val n = s.read(chunk); if (n < 0) break; total += n; if (total > 25 * 1024 * 1024) return null; buf.write(chunk, 0, n) }
            buf.toByteArray()
        } }.getOrNull() ?: return null
        val mime = ctx.contentResolver.getType(u) ?: "application/octet-stream"
        var name = "photo"
        runCatching { ctx.contentResolver.query(u, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) name = c.getString(0) ?: name } }
        return JSONObject().put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)).put("mime", mime).put("name", name)
    }
}
