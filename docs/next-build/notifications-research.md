# How chat apps do notifications on Android (research for the next build)

Studied: Telegram for Android (`NotificationsController.java`, GPL-2: behaviour only, nothing copied), Discord's
notifications (screenshots `notif-discord-*.png`, `notif-discord-popup.png`), Android's own guidance for
messaging apps. Stoat's Android app and other open-source clients (Signal, Element) follow the same pattern.

## What they all do

1. **One notification per conversation**, using Android's *messaging style*: the conversation name, each
   message with its sender's name and picture, newest last, a few recent ones kept. A new message updates
   that chat's notification instead of adding another.
2. **A group with a summary** ("Mustela · 3 chats"): all chats' notifications sit together under the app;
   only the summary makes a sound when several arrive at once (Telegram: group alert from the summary), so
   five messages don't ring five times. Sorted newest first.
3. **Sound only once per burst**: updating an existing chat's notification doesn't ring again right away
   ("only alert once"); a new message in another chat does.
4. **Conversation shortcuts** (Android 11+): each chat gets a long-lived shortcut with its name and picture,
   and the notification is linked to it. That puts Mustela's messages in Android's **Conversations** section
   at the top of the shade, lets you mark a chat as Priority, set its own sound, and allows **bubbles**
   (chat heads). Telegram does exactly this (long-lived shortcut + locus id, bubble metadata).
5. **Actions right on the notification**: **Reply** (type in the notification; sent without opening the app),
   **Mark as read** (clears it and tells the server), and Mute. Marked as "reply" / "mark as read" actions so
   watches and Android Auto understand them too; they run without opening the app.
6. **Tapping opens that chat at that message**; the notification goes away.
7. **Clears itself** when the chat is read anywhere (the app, or another device: the server's read marker).
8. **Notification channels** (Android settings): separate ones for direct messages, mentions/replies,
   group chats, calls, and the quiet background service, so people can set sounds and importance per kind
   in Android's settings. Messages use "message" category, high importance (pops up on screen, like
   `notif-discord-popup.png`).
9. **The app's own small icon** (a white silhouette) in the status bar and notification header, the
   sender's picture as the large icon, the app's accent colour, and the app name in the header.
10. **Private on the lock screen**: content hidden or shown according to the phone's lock screen setting.
11. **No sound from inside the app**: the system notification makes the only sound.

## What this means for Mustela

- Send every phone/tablet notification (app open in the background *and* closed) through one native path:
  extend `MessageWatch.post` into a shared notifier used by the page too (a new plugin command, e.g.
  `notify_message`), instead of Tauri's basic notification plugin.
- Messaging style per chat (already in MessageWatch), plus: group + summary, only-alert-once per burst,
  Mustela's `ic_notification` icon and accent colour, sender avatars as large icons.
- Long-lived conversation shortcuts per chat (name + avatar) so chats appear in Conversations and can be
  bubbles and Priority.
- Actions: Reply (RemoteInput, sends with the saved session from the native side: `POST /channels/{id}/messages`),
  Mark as read (`PUT /channels/{id}/ack/{message}`), Mute (opens a choice or mutes for 1 hour/8 hours…).
- Tap: `mustela://channel/{id}?message={msgId}` → open the chat at that message (closedNotify.ts already
  handles the channel part; add the message jump).
- Clear when read: the app clears on open (done for the background checker); also clear when the read
  marker from another device moves past it.
- Channels: Direct messages, Mentions & replies, Group chats, Calls, Checking for messages (min importance).
- Phones/tablets: never play Mustela's own message sound for notified messages.
- Desktop: confirm clicking a notification opens the chat at the message on Windows, macOS and Linux.
