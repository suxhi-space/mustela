package app.mustela.nativecall

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.Bitmap
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Every chat notification on phones and tablets, whether Mustela is open in the background (the page hands them
 * over) or closed (MessageWatch finds them), the way chat apps do it on Android:
 *  - one notification per conversation (messaging style: each message with its sender's name and picture, a few
 *    recent ones kept), all grouped under a summary so several chats sit together;
 *  - a new message in a chat that's already showing doesn't ring again within a few seconds (no five rings for five
 *    quick messages), a message in another chat does;
 *  - each chat gets a long-lived conversation shortcut (name and picture), which puts it in Android's Conversations
 *    section (Priority, its own sound, bubbles);
 *  - Reply (typed right in the notification) and Mark as read, sent with your session without opening the app;
 *  - tapping opens that chat at that message; reading the chat anywhere clears it;
 *  - separate notification channels for direct messages, mentions and replies, and group chats, so sounds and
 *    importance can be set per kind in Android's settings.
 * Your session is kept in Mustela's private storage on the phone and only ever sent to your Stoat server.
 */
object Notifier {
    const val DM = "mustela_dm"
    const val MENTIONS = "mustela_mentions"
    const val GROUPS = "mustela_groups"
    private const val GROUP_KEY = "app.mustela.CHATS"
    private const val TAG = "msg"
    private const val SUMMARY_ID = 0x4d55
    private const val PREFS = "mustela_notify"
    /** Messages in a chat closer together than this ring once. */
    private const val QUIET_MS = 12_000L

    class Line(val id: String, val author: String, val authorId: String, val text: String, val at: Long, val picture: Bitmap?, val mine: Boolean = false)
    private class Chat(var kind: String, var title: String?, val lines: ArrayList<Line> = ArrayList(), var lastAlert: Long = 0L, var lastId: String = "")

    private val chats = LinkedHashMap<String, Chat>()

    private fun manager(ctx: Context) = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val flags get() = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)

    /** Where Reply and Mark as read are sent (the page and MessageWatch keep this current). */
    fun setSession(ctx: Context, api: String, token: String) {
        if (api.isNotEmpty() && token.isNotEmpty()) prefs(ctx).edit().putString("api", api.trimEnd('/')).putString("token", Vault.seal(token)).apply()
    }
    fun forgetSession(ctx: Context) { prefs(ctx).edit().clear().apply() }
    private fun session(ctx: Context): Pair<String, String>? {
        val p = prefs(ctx); val api = p.getString("api", null); val token = Vault.open(p.getString("token", null))
        return if (api.isNullOrEmpty() || token.isNullOrEmpty()) null else api to token
    }

    fun ensureChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val m = manager(ctx)
        fun make(id: String, name: String, about: String) {
            if (m.getNotificationChannel(id) != null) return
            m.createNotificationChannel(NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH).apply { description = about })
        }
        make(DM, "Direct messages", "Messages from one person")
        make(GROUPS, "Group chats", "Messages in group chats")
        make(MENTIONS, "Mentions and replies", "When someone mentions you or replies to you in a server")
        // The single channel earlier builds used: gone, now that each kind has its own.
        runCatching { if (m.getNotificationChannel("mustela_messages") != null) m.deleteNotificationChannel("mustela_messages") }
    }

    /** A new message for `ch` ("dm", "group" or "server"; `title` names a group or "#channel, Server"). */
    fun show(ctx: Context, ch: String, kind: String, title: String?, line: Line) {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        ensureChannels(ctx)
        val now = System.currentTimeMillis()
        val (alert, chat) = synchronized(this) {
            val c = chats.getOrPut(ch) { Chat(kind, title) }
            c.kind = kind; if (title != null) c.title = title
            if (c.lines.any { it.id == line.id }) return
            c.lines.add(line); while (c.lines.size > 6) c.lines.removeAt(0)
            if (!line.mine) c.lastId = line.id
            val ring = !line.mine && now - c.lastAlert > QUIET_MS
            if (ring) c.lastAlert = now
            // Newest chats last, so the summary lists them newest first.
            chats.remove(ch); chats[ch] = c
            ring to c
        }
        render(ctx, ch, chat, alert)
        summary(ctx)
    }

    /** Read in the app or on another device, or answered: the chat's notification goes. */
    fun clear(ctx: Context, ch: String) {
        synchronized(this) { chats.remove(ch) }
        manager(ctx).cancel(TAG, ch.hashCode())
        summary(ctx)
    }

    /** Each showing chat's newest message (to clear the ones read elsewhere). */
    fun lastIds(): Map<String, String> = synchronized(this) { chats.mapValues { it.value.lastId } }

    /** Swiped away: starts fresh next time. */
    fun dismissed(ctx: Context, ch: String) { synchronized(this) { chats.remove(ch) }; summary(ctx) }

    private fun channelFor(kind: String) = when (kind) { "dm" -> DM; "group" -> GROUPS; else -> MENTIONS }

    private fun render(ctx: Context, ch: String, c: Chat, alert: Boolean) {
        val last = c.lines.lastOrNull() ?: return
        val lastOther = c.lines.lastOrNull { !it.mine } ?: last
        val open = Intent(Intent.ACTION_VIEW, Uri.parse("mustela://channel/$ch" + if (c.lastId.isNotEmpty()) "?message=${c.lastId}" else ""))
            .setPackage(ctx.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val code = ch.hashCode()
        val tap = PendingIntent.getActivity(ctx, code, open, flags)
        val dismiss = PendingIntent.getBroadcast(ctx, code, Intent(ctx, NotifyReceiver::class.java).setAction(NotifyReceiver.DISMISS).putExtra("channel", ch), flags)
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, channelFor(c.kind)) else @Suppress("DEPRECATION") Notification.Builder(ctx).setPriority(Notification.PRIORITY_HIGH)
        b.setSmallIcon(MessageWatch.smallIcon(ctx)).setContentIntent(tap).setDeleteIntent(dismiss).setAutoCancel(true)
            .setCategory(Notification.CATEGORY_MESSAGE).setWhen(last.at).setShowWhen(true)
            .setGroup(GROUP_KEY).setOnlyAlertOnce(!alert)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
        accent(ctx)?.let { b.setColor(it) }
        if (Build.VERSION.SDK_INT >= 26) b.setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
        val name = c.title ?: lastOther.author
        if (Build.VERSION.SDK_INT >= 28) {
            val me = Person.Builder().setName("You").setKey("me").build()
            val style = Notification.MessagingStyle(me)
            if (c.kind != "dm") { style.conversationTitle = name; style.isGroupConversation = true }
            for (x in c.lines) {
                val who = if (x.mine) null else Person.Builder().setName(x.author).setKey(x.authorId).apply { x.picture?.let { setIcon(Icon.createWithBitmap(it)) } }.build()
                style.addMessage(Notification.MessagingStyle.Message(x.text, x.at, who))
            }
            b.setStyle(style)
            lastOther.picture?.let { b.setLargeIcon(it) }
        } else {
            @Suppress("DEPRECATION") val style = Notification.MessagingStyle("You")
            if (c.kind != "dm") style.conversationTitle = name
            @Suppress("DEPRECATION") for (x in c.lines) style.addMessage(x.text, x.at, if (x.mine) null else x.author)
            b.setStyle(style).setContentTitle(name).setContentText(last.text)
            lastOther.picture?.let { b.setLargeIcon(it) }
        }
        // Reply and Mark as read, right on the notification (watches and car screens understand them too).
        if (session(ctx) != null) {
            val replyIntent = PendingIntent.getBroadcast(ctx, code + 1, Intent(ctx, NotifyReceiver::class.java).setAction(NotifyReceiver.REPLY).putExtra("channel", ch),
                PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0))
            val input = RemoteInput.Builder(NotifyReceiver.TEXT).setLabel(if (c.kind == "dm") "Message ${lastOther.author}" else "Reply").build()
            val reply = Notification.Action.Builder(Icon.createWithResource(ctx, MessageWatch.smallIcon(ctx)), "Reply", replyIntent).addRemoteInput(input)
            if (Build.VERSION.SDK_INT >= 28) reply.setSemanticAction(Notification.Action.SEMANTIC_ACTION_REPLY)
            if (Build.VERSION.SDK_INT >= 24) reply.setAllowGeneratedReplies(true)
            val readIntent = PendingIntent.getBroadcast(ctx, code + 2, Intent(ctx, NotifyReceiver::class.java).setAction(NotifyReceiver.READ).putExtra("channel", ch).putExtra("message", c.lastId), flags)
            val read = Notification.Action.Builder(Icon.createWithResource(ctx, MessageWatch.smallIcon(ctx)), "Mark as read", readIntent)
            if (Build.VERSION.SDK_INT >= 28) read.setSemanticAction(Notification.Action.SEMANTIC_ACTION_MARK_AS_READ)
            b.addAction(reply.build()).addAction(read.build())
        }
        // The conversation's shortcut: Android's Conversations section, Priority and bubbles.
        if (Build.VERSION.SDK_INT >= 30) runCatching {
            val id = "chat_$ch"
            val icon = (c.lines.lastOrNull { !it.mine }?.picture)?.let { Icon.createWithAdaptiveBitmap(it) } ?: Icon.createWithResource(ctx, ctx.applicationInfo.icon)
            val person = Person.Builder().setName(name).setKey(ch).setIcon(icon).build()
            val sc = ShortcutInfo.Builder(ctx, id).setShortLabel(name.take(24)).setLongLabel(name).setIcon(icon).setPerson(person).setLongLived(true)
                .setIntent(Intent(Intent.ACTION_VIEW, Uri.parse("mustela://channel/$ch")).setPackage(ctx.packageName))
                .setCategories(setOf("app.mustela.CHAT")).build()
            ctx.getSystemService(ShortcutManager::class.java)?.pushDynamicShortcut(sc)
            b.setShortcutId(id)
        }
        manager(ctx).notify(TAG, code, b.build())
    }

    /** "Mustela · 3 chats": holds the chats together (Android shows it once there are several). Never rings itself. */
    private fun summary(ctx: Context) {
        val list = synchronized(this) { chats.entries.toList().reversed() }
        if (list.isEmpty()) { manager(ctx).cancel(TAG, SUMMARY_ID); return }
        if (Build.VERSION.SDK_INT < 24) return
        val style = Notification.InboxStyle()
        for ((_, c) in list.take(5)) { val l = c.lines.lastOrNull { !it.mine } ?: continue; style.addLine("${c.title ?: l.author}: ${l.text}") }
        val n = list.size
        style.setSummaryText(if (n == 1) "1 chat" else "$n chats")
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, DM) else @Suppress("DEPRECATION") Notification.Builder(ctx)
        b.setSmallIcon(MessageWatch.smallIcon(ctx)).setStyle(style).setGroup(GROUP_KEY).setGroupSummary(true).setOnlyAlertOnce(true)
            .setAutoCancel(true).setCategory(Notification.CATEGORY_MESSAGE).setContentTitle("Mustela").setContentText(if (n == 1) "1 chat" else "$n chats")
        accent(ctx)?.let { b.setColor(it) }
        if (Build.VERSION.SDK_INT >= 26) b.setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
        manager(ctx).notify(TAG, SUMMARY_ID, b.build())
    }

    private fun accent(ctx: Context): Int? = prefs(ctx).getInt("accent", 0).takeIf { it != 0 }
    fun setAccent(ctx: Context, argb: Int) { prefs(ctx).edit().putInt("accent", argb).apply() }

    /* ---------- actions (run off the main thread) ---------- */

    private fun request(ctx: Context, method: String, path: String, body: String?): Boolean {
        val (api, token) = session(ctx) ?: return false
        val c = URL(api + path).openConnection() as HttpURLConnection
        c.requestMethod = method; c.connectTimeout = 12_000; c.readTimeout = 15_000
        c.setRequestProperty("X-Session-Token", token)
        if (body != null) { c.doOutput = true; c.setRequestProperty("Content-Type", "application/json"); c.outputStream.use { it.write(body.toByteArray()) } }
        return try { c.responseCode in 200..299 } finally { c.disconnect() }
    }

    fun reply(ctx: Context, ch: String, text: String) {
        val ok = runCatching { request(ctx, "POST", "/channels/$ch/messages", JSONObject().put("content", text).toString()) }.getOrDefault(false)
        val chat = synchronized(this) { chats[ch] } ?: return
        // Shown in the conversation as yours (or that it didn't go), without ringing.
        show(ctx, ch, chat.kind, chat.title, Line("me-${System.nanoTime()}", "You", "me", if (ok) text else "Couldn't send: $text", System.currentTimeMillis(), null, mine = true))
        if (ok && chat.lastId.isNotEmpty()) runCatching { request(ctx, "PUT", "/channels/$ch/ack/${chat.lastId}", null) }
    }

    fun markRead(ctx: Context, ch: String, message: String?) {
        val id = message?.takeIf { it.isNotEmpty() } ?: synchronized(this) { chats[ch]?.lastId } ?: ""
        clear(ctx, ch)
        if (id.isNotEmpty()) runCatching { request(ctx, "PUT", "/channels/$ch/ack/$id", null) }
    }
}

class NotifyReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val ch = intent.getStringExtra("channel") ?: return
        when (intent.action) {
            DISMISS -> Notifier.dismissed(ctx, ch)
            REPLY -> {
                val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(TEXT)?.toString()?.trim().orEmpty()
                if (text.isEmpty()) return
                val done = goAsync()
                Thread { try { Notifier.reply(ctx.applicationContext, ch, text) } finally { done.finish() } }.start()
            }
            READ -> {
                val done = goAsync()
                Thread { try { Notifier.markRead(ctx.applicationContext, ch, intent.getStringExtra("message")) } finally { done.finish() } }.start()
            }
        }
    }

    companion object {
        const val REPLY = "app.mustela.NOTIFY_REPLY"
        const val READ = "app.mustela.NOTIFY_READ"
        const val DISMISS = "app.mustela.NOTIFY_DISMISS"
        const val TEXT = "text"
    }
}
