package app.mustela.nativecall

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** The viewer's shared files (a subclass only so its manifest entry doesn't collide with the app's own FileProvider). */
class SharedFilesProvider : FileProvider()

/**
 * The picture viewer's Save and Share on Android. Save puts the picture or video straight into your gallery
 * (Pictures/Mustela or Movies/Mustela; other files into Downloads), so it shows in your photos app. Share copies it
 * into Mustela's own cache and hands the file itself to the share sheet (not just its link). Run off the main thread.
 */
object Media {
    private const val MAX = 200L * 1024 * 1024

    private class Got(val file: File, val mime: String)

    private fun safe(name: String) = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(120).ifBlank { "file" }

    /** Downloads into the cache (https only, size-capped), with its type. */
    private fun download(ctx: Context, url: String, name: String): Got {
        val u = URL(url)
        if (u.protocol != "https" && u.protocol != "http") throw IllegalArgumentException("not a web link")
        val c = u.openConnection() as HttpURLConnection
        c.connectTimeout = 15_000; c.readTimeout = 30_000; c.instanceFollowRedirects = true
        // The same user agent the app's pictures load with: some file servers turn away Java's default one.
        runCatching { c.setRequestProperty("User-Agent", android.webkit.WebSettings.getDefaultUserAgent(ctx)) }
        try {
            if (c.responseCode !in 200..299) throw IllegalStateException("the server said ${c.responseCode}")
            val mime = c.contentType?.substringBefore(';')?.trim()?.takeIf { it.contains('/') }
                ?: android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
            val dir = File(ctx.cacheDir, "shared").apply { mkdirs() }
            dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 24 * 3600_000L }?.forEach { it.delete() }
            var fname = safe(name)
            if (!fname.contains('.')) android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?.let { fname += ".$it" }
            val out = File(dir, fname)
            var total = 0L
            c.inputStream.use { input -> out.outputStream().use { o ->
                val buf = ByteArray(64 * 1024)
                while (true) { val n = input.read(buf); if (n < 0) break; total += n; if (total > MAX) throw IllegalStateException("too big"); o.write(buf, 0, n) }
            } }
            return Got(out, mime)
        } finally { c.disconnect() }
    }

    /** Into the gallery (Android 10+), or Downloads on older phones. Returns where it went, for the message. */
    fun save(ctx: Context, url: String, name: String): String {
        val got = download(ctx, url, name)
        try {
            val image = got.mime.startsWith("image/"); val video = got.mime.startsWith("video/")
            if (Build.VERSION.SDK_INT >= 29) {
                val (collection, folder) = when {
                    image -> MediaStore.Images.Media.EXTERNAL_CONTENT_URI to "${Environment.DIRECTORY_PICTURES}/Mustela"
                    video -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI to "${Environment.DIRECTORY_MOVIES}/Mustela"
                    else -> MediaStore.Downloads.EXTERNAL_CONTENT_URI to "${Environment.DIRECTORY_DOWNLOADS}/Mustela"
                }
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, got.file.name); put(MediaStore.MediaColumns.MIME_TYPE, got.mime)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, folder); put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val r = ctx.contentResolver
                val uri = r.insert(collection, values) ?: throw IllegalStateException("no room to save")
                r.openOutputStream(uri)?.use { o -> got.file.inputStream().use { it.copyTo(o) } } ?: throw IllegalStateException("couldn't write")
                r.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                return if (image) "Saved to Photos" else if (video) "Saved to Videos" else "Saved to Downloads"
            }
            // Older phones: the download manager (it shows its own "download complete").
            val req = android.app.DownloadManager.Request(Uri.parse(url)).setTitle(got.file.name)
                .setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, got.file.name)
            (ctx.getSystemService(Context.DOWNLOAD_SERVICE) as android.app.DownloadManager).enqueue(req)
            return "Saving to Downloads"
        } finally { got.file.delete() }
    }

    /** The share sheet with the file itself. */
    fun share(ctx: Context, url: String, name: String): Intent {
        val got = download(ctx, url, name)
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.mustela.files", got.file)
        val send = Intent(Intent.ACTION_SEND).apply { type = got.mime; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        return Intent.createChooser(send, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}
