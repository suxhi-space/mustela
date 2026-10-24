package app.mustela.nativecall

import android.content.Context
import android.util.Log
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The one voice call, owned by the process rather than by the WebView.
 * That is the whole point: Android destroys the Activity (and with it the
 * WebView) when you swipe the app out of recents, but this object, kept
 * alive by [CallService], carries on.
 *
 * Voice only. Camera and screen share stay with the web engine.
 */
object CallEngine {
    private const val TAG = "MustelaCall"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var room: Room? = null

    @Volatile var channelId: String? = null
    @Volatile var channelName: String? = null
    @Volatile var micOn = false
    @Volatile var error: String? = null

    fun active() = room != null

    /** Connects and returns once the room is joined. Throws on failure. */
    suspend fun start(ctx: Context, url: String, token: String, id: String, name: String) {
        stop()
        error = null; micOn = false; channelId = id; channelName = name
        val r = LiveKit.create(ctx.applicationContext)
        room = r
        scope.launch {
            r.events.collect { e ->
                if (e is RoomEvent.Disconnected) {
                    if (room === r) {
                        error = e.error?.message ?: "Disconnected"
                        room = null
                        CallService.stop(ctx.applicationContext)
                    }
                }
            }
        }
        try {
            r.connect(url, token)
        } catch (t: Throwable) {
            Log.w(TAG, "connect failed", t)
            if (room === r) room = null
            runCatching { r.disconnect() }
            throw t
        }
    }

    suspend fun setMic(on: Boolean) {
        val r = room ?: return
        r.localParticipant.setMicrophoneEnabled(on)
        micOn = on
    }

    fun stop() {
        val r = room ?: return
        room = null
        micOn = false
        runCatching { r.disconnect() }
        runCatching { r.release() }
    }

    /** Ids (LiveKit identities are Stoat user ids). */
    fun participants(): List<String> {
        val r = room ?: return emptyList()
        val out = ArrayList<String>()
        r.localParticipant.identity?.value?.let { out.add(it) }
        r.remoteParticipants.values.forEach { p -> p.identity?.value?.let { out.add(it) } }
        return out
    }

    fun speaking(): List<String> = room?.activeSpeakers?.mapNotNull { it.identity?.value } ?: emptyList()

    fun connected() = room?.state == Room.State.CONNECTED
}
