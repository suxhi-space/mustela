package app.mustela.nativecall

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Notifications while Mustela is closed, without looking online and without draining the battery.
 *
 * Stoat only pushes to its own app (through Google's service, with Stoat's keys), and any live connection to Stoat
 * shows you as online. So instead this asks Stoat now and then, over plain web requests (which don't count as being
 * online), whether anything new came in for you: about once a minute while the screen is on (the phone's radio is
 * awake anyway), and roughly every 15 minutes while it's off, when Android wakes apps in batches. Nothing runs while
 * Mustela itself is open: the app tells this side it's alive (see alive()) and handles notifications itself.
 *
 * The page hands over what it knows (see configure): your session, which channels notify how (mutes, "mentions
 * only"...), channel names. The session stays in Mustela's private storage on the phone and is only ever sent to
 * your Stoat server, the same as the app does.
 */
object MessageWatch {
    private const val PREFS = "mustela_watch"
    private const val MSG_CHANNEL = "mustela_messages"
    private const val ALIVE_MS = 45_000L
    private const val TAG = "msg"

    @Volatile private var running = false
    private val people = HashMap<String, JSONObject>()
    private val pictures = object : LinkedHashMap<String, Bitmap?>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Bitmap?>?) = size > 60
    }
    /** What each channel's notification shows: the last few messages, newest last. */
    private val shown = HashMap<String, ArrayList<Shown>>()
    private val seen = LinkedHashSet<String>()

    private class Shown(val id: String, val author: String, val text: String, val at: Long, val picture: Bitmap?, val authorId: String)

    private fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(ctx: Context) = prefs(ctx).getString("profile", null) != null

    /** On with the page's profile (JSON), or off: forgets the session and stops checking. */
    fun configure(ctx: Context, on: Boolean, profile: String?) {
        val p = prefs(ctx)
        if (on && !profile.isNullOrEmpty()) {
            val first = p.getString("profile", null) == null
            p.edit().putString("profile", profile).apply()
            if (first) p.edit().putLong("since", System.currentTimeMillis()).apply()
            MessageWatchService.start(ctx)
        } else {
            p.edit().clear().apply()
            synchronized(this) { people.clear(); shown.clear(); seen.clear() }
            MessageWatchService.stop(ctx)
            cancelAlarm(ctx)
        }
    }

    /**
     * The app is open and handling notifications itself (true, repeated every ~20 s), or it just let go (false: it
     * closed its connection, so checking takes over from this moment).
     */
    fun alive(ctx: Context, on: Boolean) {
        val now = System.currentTimeMillis()
        val e = prefs(ctx).edit().putLong("alive", if (on) now else 0L)
        e.putLong("since", now)
        e.apply()
    }

    /** You looked at this channel in the app: its notification goes. */
    fun clear(ctx: Context, channel: String) {
        synchronized(this) { shown.remove(channel) }
        manager(ctx).cancel(TAG, channel.hashCode())
    }

    /* ---------- checking ---------- */

    /** One check, on whatever thread calls it (never the main one). Skipped while the app is open. */
    fun check(ctx: Context) {
        val p = prefs(ctx)
        val profile = p.getString("profile", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return
        if (System.currentTimeMillis() - p.getLong("alive", 0L) < ALIVE_MS) return
        synchronized(this) { if (running) return; running = true }
        try {
            val started = System.currentTimeMillis()
            val since = p.getLong("since", started)
            Check(ctx, profile, since).run()
            // A little overlap with the next check, so nothing slips between them (seen keeps out repeats).
            if (prefs(ctx).getString("profile", null) != null) p.edit().putLong("since", started - 3_000L).apply()
        } catch (e: Unauthorized) {
            // Signed out somewhere else, or the session was removed in Settings > Sessions: stop until the app is opened.
            configure(ctx, false, null)
        } catch (_: Exception) {
            // Offline or Stoat unreachable: try again next time, from the same point.
        } finally {
            synchronized(this) { running = false }
        }
    }

    private class Unauthorized : Exception()

    private class Check(val ctx: Context, val profile: JSONObject, val since: Long) {
        val api = profile.optString("api").trimEnd('/')
        val autumn = profile.optString("autumn").trimEnd('/')
        val token = profile.optString("token")
        val me = profile.optString("me")
        val preview = profile.optBoolean("preview", true)
        val quiet = profile.optString("quiet")
        val levels = profile.optJSONObject("levels") ?: JSONObject()
        val titles = profile.optJSONObject("titles") ?: JSONObject()
        val kinds = profile.optJSONObject("kinds") ?: JSONObject()
        val blocked = profile.optJSONArray("blocked")?.let { a -> (0 until a.length()).map { a.optString(it) }.toHashSet() } ?: hashSetOf()
        val sinceId = ulidAt(since)

        fun run() {
            if (quiet == "busy") return
            // Read markers and mentions (Stoat works out who a message mentions, roles and @everyone included).
            val read = HashMap<String, String>()
            val mentions = ArrayList<Pair<String, String>>()
            val unreads = get("/sync/unreads") as? JSONArray ?: JSONArray()
            for (i in 0 until unreads.length()) {
                val u = unreads.optJSONObject(i) ?: continue
                val ch = u.optJSONObject("_id")?.optString("channel") ?: continue
                u.optString("last_id").takeIf { it.isNotEmpty() }?.let { read[ch] = it }
                val m = u.optJSONArray("mentions") ?: continue
                for (j in 0 until m.length()) { val id = m.optString(j); if (id > sinceId) mentions.add(ch to id) }
            }
            // Direct messages and groups with something new.
            val fetch = LinkedHashMap<String, String>()
            val dms = get("/users/dms") as? JSONArray ?: JSONArray()
            for (i in 0 until dms.length()) {
                val c = dms.optJSONObject(i) ?: continue
                val id = c.optString("_id")
                val kind = when (c.optString("channel_type")) { "DirectMessage" -> "dm"; "Group" -> "group"; else -> continue }
                if (!kinds.has(id)) kinds.put(id, kind)
                if (kind == "group" && !titles.has(id)) titles.put(id, c.optString("name"))
                consider(id, c.optString("last_message_id"), read, fetch)
            }
            // Server channels set to "All messages" (most are mentions only, which the unreads above cover).
            val watch = profile.optJSONArray("watch") ?: JSONArray()
            for (i in 0 until minOf(watch.length(), 15)) {
                val id = watch.optString(i)
                val c = get("/channels/$id") as? JSONObject ?: continue
                consider(id, c.optString("last_message_id"), read, fetch)
            }
            for ((ch, after) in fetch) {
                val r = get("/channels/$ch/messages?limit=10&sort=Oldest&include_users=true&after=" + enc(after)) as? JSONObject ?: continue
                remember(r.optJSONArray("users"), r.optJSONArray("members"))
                val list = r.optJSONArray("messages") ?: continue
                for (i in 0 until list.length()) list.optJSONObject(i)?.let { show(it, ch, r.optJSONArray("members")) }
            }
            for ((ch, id) in mentions) {
                if (fetch.containsKey(ch) || id in seen || level(ch) == "none") continue
                val m = get("/channels/$ch/messages/$id") as? JSONObject ?: continue
                show(m, ch, null, mentioned = true)
            }
            // Read somewhere else (the app on your computer, say): that channel's notification goes.
            val gone = synchronized(MessageWatch) { shown.filter { (ch, list) -> list.isNotEmpty() && (read[ch] ?: "") >= list.last().id }.keys.toList() }
            for (ch in gone) clear(ctx, ch)
        }

        fun level(ch: String): String = levels.optString(ch).ifEmpty { if (kinds.optString(ch) == "dm" || kinds.optString(ch) == "group") "all" else "mention" }

        fun consider(ch: String, last: String, read: Map<String, String>, fetch: MutableMap<String, String>) {
            if (last.isEmpty() || last <= sinceId || (read[ch] ?: "") >= last) return
            if (level(ch) != "all") return // mentions come from the unreads
            fetch[ch] = maxOf(read[ch] ?: "", sinceId)
        }

        fun show(m: JSONObject, ch: String, members: JSONArray?, mentioned: Boolean = false) {
            val id = m.optString("_id")
            val author = m.optString("author")
            if (id.isEmpty() || id <= sinceId || author == me || author in blocked) return
            synchronized(MessageWatch) { if (!seen.add(id)) return; if (seen.size > 400) seen.remove(seen.first()) }
            val kind = kinds.optString(ch)
            val direct = kind == "dm" || kind == "group"
            val mentionsMe = mentioned || m.optJSONArray("mentions")?.let { a -> (0 until a.length()).any { a.optString(it) == me } } == true
            val lv = level(ch)
            if (lv == "none" || (lv == "mention" && !mentionsMe)) return
            if (quiet == "focus" && !direct && !mentionsMe) return
            if (m.has("system") && m.optString("content").isEmpty()) return
            val user = person(author)
            val member = members?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) }.firstOrNull { it.optJSONObject("_id")?.optString("user") == author } }
            val mask = m.optJSONObject("masquerade")
            val name = mask?.optString("name")?.takeIf { it.isNotEmpty() }
                ?: member?.optString("nickname")?.takeIf { it.isNotEmpty() }
                ?: user?.optString("display_name")?.takeIf { it.isNotEmpty() }
                ?: user?.optString("username")?.takeIf { it.isNotEmpty() } ?: "Someone"
            val pic = mask?.optString("avatar")?.takeIf { it.startsWith("https://") }
                ?: member?.optJSONObject("avatar")?.optString("_id")?.takeIf { it.isNotEmpty() }?.let { "$autumn/avatars/$it?max_side=128" }
                ?: user?.optJSONObject("avatar")?.optString("_id")?.takeIf { it.isNotEmpty() }?.let { "$autumn/avatars/$it?max_side=128" }
                ?: "$api/users/$author/default_avatar"
            val text = if (!preview) (if (direct) "Sent you a message" else "Mentioned you") else body(m)
            post(ctx, ch, Shown(id, name, text, ulidTime(id), picture(pic), author), conversation(ch, kind))
        }

        fun conversation(ch: String, kind: String): String? = when (kind) {
            "dm" -> null
            else -> titles.optString(ch).ifEmpty { null }
        }

        /** The message as a line of text: mentions and channels by name, spoilers hidden, attachments described. */
        fun body(m: JSONObject): String {
            var t = m.optString("content")
            t = Regex("\\|\\|[\\s\\S]+?\\|\\|").replace(t, "(spoiler)")
            t = Regex("<@([0-9A-HJKMNP-TV-Z]{26})>").replace(t) { r -> "@" + (person(r.groupValues[1])?.let { it.optString("display_name").ifEmpty { it.optString("username") } } ?: "someone") }
            t = Regex("<#([0-9A-HJKMNP-TV-Z]{26})>").replace(t) { r -> titles.optString(r.groupValues[1]).substringBefore(",").ifEmpty { "#channel" } }
            t = Regex(":([0-9A-HJKMNP-TV-Z]{26}):").replace(t, ":emoji:")
            t = Regex("(\\*\\*|__|~~|`)").replace(t, "").trim()
            if (t.isNotEmpty()) return t.take(400)
            val files = m.optJSONArray("attachments")
            if (files != null && files.length() > 0) {
                val type = files.optJSONObject(0)?.optString("content_type") ?: ""
                return when {
                    type.startsWith("image/") -> if (files.length() > 1) "Sent ${files.length()} pictures" else "Sent a picture"
                    type.startsWith("video/") -> "Sent a video"
                    type.startsWith("audio/") -> "Sent a voice message"
                    else -> "Sent a file"
                }
            }
            return "Sent a message"
        }

        fun remember(users: JSONArray?, @Suppress("UNUSED_PARAMETER") members: JSONArray?) {
            if (users == null) return
            synchronized(MessageWatch) { for (i in 0 until users.length()) users.optJSONObject(i)?.let { people[it.optString("_id")] = it } }
        }

        fun person(id: String): JSONObject? {
            synchronized(MessageWatch) { people[id] }?.let { return it }
            val u = runCatching { get("/users/$id") as? JSONObject }.getOrNull() ?: return null
            synchronized(MessageWatch) { if (people.size > 300) people.clear(); people[id] = u }
            return u
        }

        fun picture(url: String): Bitmap? {
            synchronized(MessageWatch) { if (pictures.containsKey(url)) return pictures[url] }
            val bmp = runCatching {
                val c = URL(url).openConnection() as HttpURLConnection
                c.connectTimeout = 8_000; c.readTimeout = 8_000
                try { if (c.responseCode == 200) c.inputStream.use { BitmapFactory.decodeStream(it) } else null } finally { c.disconnect() }
            }.getOrNull()?.let { round(it) }
            synchronized(MessageWatch) { pictures[url] = bmp }
            return bmp
        }

        fun get(path: String): Any? {
            val c = URL(api + path).openConnection() as HttpURLConnection
            c.connectTimeout = 12_000; c.readTimeout = 15_000
            c.setRequestProperty("X-Session-Token", token)
            c.setRequestProperty("Accept", "application/json")
            try {
                val code = c.responseCode
                if (code == 401) throw Unauthorized()
                if (code !in 200..299) return null
                val text = c.inputStream.bufferedReader().use { it.readText() }
                return JSONTokener(text).nextValue()
            } finally { c.disconnect() }
        }

        fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")
    }

    /* ---------- notifications ---------- */

    private fun manager(ctx: Context) = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val m = manager(ctx)
        if (m.getNotificationChannel(MSG_CHANNEL) != null) return
        m.createNotificationChannel(NotificationChannel(MSG_CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Direct messages and mentions while Mustela is closed"
        })
    }

    /** One notification per conversation, like other chat apps: the last few messages, who sent them, with pictures. */
    private fun post(ctx: Context, ch: String, s: Shown, conversation: String?) {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        ensureChannel(ctx)
        val list = synchronized(this) {
            val l = shown.getOrPut(ch) { ArrayList() }
            l.add(s); while (l.size > 6) l.removeAt(0)
            ArrayList(l)
        }
        val open = Intent(Intent.ACTION_VIEW, Uri.parse("mustela://channel/$ch")).setPackage(ctx.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
        val tap = PendingIntent.getActivity(ctx, ch.hashCode(), open, flags)
        val dismiss = PendingIntent.getBroadcast(ctx, ch.hashCode(),
            Intent(ctx, MessageWatchReceiver::class.java).setAction(MessageWatchReceiver.DISMISS).putExtra("channel", ch), flags)
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, MSG_CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(ctx).setPriority(Notification.PRIORITY_HIGH)
        b.setSmallIcon(smallIcon(ctx)).setContentIntent(tap).setDeleteIntent(dismiss).setAutoCancel(true)
            .setCategory(Notification.CATEGORY_MESSAGE).setWhen(s.at).setShowWhen(true)
        if (Build.VERSION.SDK_INT >= 28) {
            val style = Notification.MessagingStyle(Person.Builder().setName("You").build())
            if (conversation != null) { style.conversationTitle = conversation; style.isGroupConversation = true }
            for (x in list) {
                val who = Person.Builder().setName(x.author).setKey(x.authorId).apply { x.picture?.let { setIcon(Icon.createWithBitmap(it)) } }.build()
                style.addMessage(Notification.MessagingStyle.Message(x.text, x.at, who))
            }
            b.setStyle(style)
        } else {
            @Suppress("DEPRECATION")
            val style = Notification.MessagingStyle("You")
            if (conversation != null) style.conversationTitle = conversation
            @Suppress("DEPRECATION")
            for (x in list) style.addMessage(x.text, x.at, x.author)
            b.setStyle(style).setContentTitle(conversation ?: s.author).setContentText(s.text)
            s.picture?.let { b.setLargeIcon(it) }
        }
        manager(ctx).notify(TAG, ch.hashCode(), b.build())
    }

    /** The dismissed notification starts fresh next time. */
    fun dismissed(channel: String) { synchronized(this) { shown.remove(channel) } }

    fun smallIcon(ctx: Context): Int {
        val id = ctx.resources.getIdentifier("ic_notification", "drawable", ctx.packageName)
        return if (id != 0) id else ctx.applicationInfo.icon
    }

    private fun round(src: Bitmap): Bitmap {
        val size = minOf(src.width, src.height, 192)
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val clip = Path().apply { addCircle(size / 2f, size / 2f, size / 2f, Path.Direction.CW) }
        c.clipPath(clip)
        val scaled = Bitmap.createScaledBitmap(src, size, size, true)
        c.drawBitmap(scaled, 0f, 0f, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
        return out
    }

    /* ---------- ULIDs: Stoat's ids start with the time they were made ---------- */

    private const val CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

    fun ulidTime(id: String): Long {
        var t = 0L
        for (i in 0 until minOf(10, id.length)) { val v = CROCKFORD.indexOf(id[i]); if (v < 0) return 0L; t = t * 32 + v }
        return t
    }

    /** The smallest id made at `ms`: everything after it is newer. */
    fun ulidAt(ms: Long): String {
        val c = CharArray(10); var t = ms
        for (i in 9 downTo 0) { c[i] = CROCKFORD[(t % 32).toInt()]; t /= 32 }
        return String(c) + "0000000000000000"
    }

    /* ---------- when to check ---------- */

    /** Screen off: Android wakes Mustela about every 15 minutes, batched with other apps (no exact alarms, no wake locks). */
    fun scheduleAlarm(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = alarmIntent(ctx)
        val at = SystemClock.elapsedRealtime() + 15 * 60_000L
        if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi)
        else am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi)
    }

    fun cancelAlarm(ctx: Context) {
        (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(alarmIntent(ctx))
    }

    private fun alarmIntent(ctx: Context): PendingIntent {
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
        return PendingIntent.getBroadcast(ctx, 4711, Intent(ctx, MessageWatchReceiver::class.java).setAction(MessageWatchReceiver.CHECK), flags)
    }
}

/**
 * Keeps Mustela's process around while it's closed so it can check for messages (Android requires a notification
 * for that; it's set to the lowest level, and can be hidden in Android's settings without stopping anything).
 * It holds no connection and no wake lock: between checks it just sleeps.
 */
class MessageWatchService : Service() {
    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    private var screen: BroadcastReceiver? = null
    private val tick = object : Runnable {
        override fun run() {
            val h = handler ?: return
            if ((getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive) {
                MessageWatch.check(applicationContext)
                h.postDelayed(this, 60_000L)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP || !MessageWatch.enabled(this)) { stopSelf(); return START_NOT_STICKY }
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(ID, note(), ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
            else startForeground(ID, note())
        } catch (_: Exception) {
            // Android didn't allow it right now (started from the background): the 15-minute checks still run.
            MessageWatch.scheduleAlarm(this)
            stopSelf()
            return START_NOT_STICKY
        }
        if (thread == null) {
            thread = HandlerThread("mustela-watch").also { it.start() }
            handler = Handler(thread!!.looper)
            screen = object : BroadcastReceiver() {
                override fun onReceive(c: Context, i: Intent) {
                    val h = handler ?: return
                    h.removeCallbacks(tick)
                    if (i.action == Intent.ACTION_SCREEN_ON) h.postDelayed(tick, 2_000L)
                }
            }
            val f = IntentFilter().apply { addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF) }
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(screen, f, Context.RECEIVER_NOT_EXPORTED) else registerReceiver(screen, f)
            handler!!.postDelayed(tick, 5_000L)
        }
        MessageWatch.scheduleAlarm(this)
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) { /* the app was swiped away: this is exactly when checking matters */ }

    override fun onDestroy() {
        screen?.let { runCatching { unregisterReceiver(it) } }
        handler?.removeCallbacksAndMessages(null)
        thread?.quitSafely()
        thread = null; handler = null; screen = null
        super.onDestroy()
    }

    private fun note(): Notification {
        val m = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26 && m.getNotificationChannel(CHANNEL) == null) {
            m.createNotificationChannel(NotificationChannel(CHANNEL, "Checking for messages", NotificationManager.IMPORTANCE_MIN).apply {
                description = "Lets Mustela check for messages while it's closed. You can turn this one off; notifications keep coming."
                setShowBadge(false)
            })
        }
        val open = packageManager.getLaunchIntentForPackage(packageName)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this).setPriority(Notification.PRIORITY_MIN)
        b.setSmallIcon(MessageWatch.smallIcon(this)).setContentTitle("Checking for messages")
            .setContentText("Mustela stays offline and checks now and then while it's closed.")
            .setOngoing(true).setShowWhen(false)
        if (open != null) b.setContentIntent(PendingIntent.getActivity(this, 0, open, flags))
        return b.build()
    }

    companion object {
        private const val ID = 4712
        private const val CHANNEL = "mustela_watch"
        private const val ACTION_STOP = "app.mustela.WATCH_STOP"

        fun start(ctx: Context) {
            val i = Intent(ctx, MessageWatchService::class.java)
            runCatching { if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i) }
                .onFailure { MessageWatch.scheduleAlarm(ctx) }
        }

        fun stop(ctx: Context) {
            runCatching { ctx.stopService(Intent(ctx, MessageWatchService::class.java)) }
        }
    }
}

/** The 15-minute check, starting again after the phone restarts or Mustela updates, and dismissed notifications. */
class MessageWatchReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            DISMISS -> intent.getStringExtra("channel")?.let { MessageWatch.dismissed(it) }
            CHECK, Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                if (!MessageWatch.enabled(ctx)) return
                MessageWatch.scheduleAlarm(ctx)
                if (intent.action != CHECK) MessageWatchService.start(ctx)
                val done = goAsync()
                Thread {
                    try { MessageWatch.check(ctx.applicationContext) } finally { done.finish() }
                }.start()
            }
        }
    }

    companion object {
        const val CHECK = "app.mustela.WATCH_CHECK"
        const val DISMISS = "app.mustela.WATCH_DISMISS"
    }
}
