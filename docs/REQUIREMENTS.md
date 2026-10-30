# Mustela: every request, as a checklist

Made from the full chat history ("Mustela: requests and history", 23–29 October 2026). It covers everything asked for
after 0.1.0 was built, plus anything earlier that 0.1.0 doesn't do. Each item is ticked only once it's built **and**
tested. ✅ done · ⬜ to do · 🧪 built, needs testing on a real device

## Ground rules (from every message)
- Mustela is to Stoat what Vesktop is to Discord: every Stoat feature, Mustela's own look, plus extras.
- Light: low RAM, CPU and GPU, no lag in games, no crashes. Built for both high-end and low-end machines.
- The same interface, look and features on Windows, macOS, Linux, Android (phones, tablets, Chromebooks) and iOS.
  Fully responsive, and any window size works.
- Look: 0.1.0's look (iOS 6 feel, Material You colour, VRChat-style 3D, Stoat/Discord layout). No "AI-looking" UI:
  no glows, gradient text or colour blobs.
- Messages keep Mustela's original mention style. Only the text box gets chips.
- Upgrading from 0.1.0 must be seamless: settings, profile and decorations keep syncing (see REBUILD-PLAN.md).
- Compare with Stoat's own clients (for-web, for-desktop, for-android, for-ios) so default features behave the same.

## Build, install, update
- ✅ The build script asks for the version and the GitHub repo for updates
- ✅ Self-update: Windows and AppImage install themselves; Mac and .deb open the file; phones open the release page
- ✅ Android build: the JitPack/Gradle clash and the autostart permission
- 🧪 AppImage install should work the way VRCX's does (github.com/vrcx-team/VRCX): a clean move into ~/Applications,
  a menu entry with icon, a desktop shortcut, and updates that keep working from the new location
- 🧪 The desktop app remembers its window size and position
- 🧪 Windows installs to Program Files (0.1.0 has it; check)
- 🧪 A release workflow on GitHub Actions (.github/workflows/release.yml: push a tag, check the draft, publish)

## Phones and tablets (25 Oct: back button, cut-off screens, padding)
- 🧪 The Android back button goes back a screen (channel → channel list → servers) and closes overlays, settings
  and dialogs, instead of leaving the app
- 🧪 Padding around the status bar and the navigation bar everywhere; nothing cut off; the keyboard doesn't cover the
  text box
- 🧪 Tapping a server shows its channels; a channel opens full screen with a back arrow
- 🧪 Phones keep the bottom-left card, padded, with the inbox bell on it (Discord mobile's card, 30 Oct); tapping
  the card opens your card menu (edit profile, status, accounts, settings). The inbox opens full screen like Settings
- 🧪 Tablets: a hybrid of desktop and phone: the full layout with touch sizes and the bell on the card
- 🧪 Calls: something like Discord's mobile voice overlay (a bubble over other apps: tap to come back, hold to mute)
  instead of the buggy
  picture-in-picture
- 🧪 Calls keep going when the app is swiped away from recents (native call engine: a foreground service owns the call)
- 🧪 Call audio uses the call volume, not media volume
- 🧪 Mobile calls work better overall (see the Discord mobile recordings): bubble, call volume, screen share
- 🧪 Screen share on Android (web call engine; Android's own prompt picks the screen; no sound yet)
- 🧪 Android 12+ wallpaper colours (Material You), already offered as a setting; check it works on a phone

## Chat
- 🧪 Drafts are kept per channel and DM when switching (Stoat does this), and after a restart; attachments stay
  with the channel they were added in
- 🧪 Mentions, #channels, roles and message links show as chips in the text box (sent messages keep their look)
- 🧪 Spoiler option on photo uploads (Stoat's `SPOILER_` naming)
- 🧪 A formatting toolbar that follows the selection (bold, italic, underline, strike, spoiler, code, code block,
  quote, link), plus Ctrl/Cmd+B, I, U
- 🧪 Autocomplete for #channels, roles, @everyone and @online
- 🧪 Going back to a server reopens the channel you were last in (kept after a restart)
- 🧪 Home goes back to the last DM, for this session only
- 🧪 Channels: jump back to the first unread message ("N new messages since…" with Jump and Mark as read, and a
  "New" line). DMs open at the first unread message
- 🧪 Inbox: mentions only (you, your roles, @everyone, following your notification settings); click to jump to the
  message
- 🧪 New DMs show under the Home button above the server list, as avatars with a badge
- 🧪 Read-only channels say so; slowmode shows a countdown; typing indicator keeps showing while you type
- 🧪 Edit, delete and reaction errors are shown
- 🧪 Messages missed during a reconnect load automatically
- 🧪 Notifications respect Busy/Focus and skip blocked people
- 🧪 Server folders open and close again (30 Oct)
- 🧪 Drag to rearrange channels and categories (if you can manage channels; saved to Stoat like its own client)
- 🧪 Pin server channels to the top of their server, and Favourites (channels from any server) on Home; both sync,
  drag to reorder
- 🧪 Pinned DMs: drag to reorder, drag into another pin group, drag out to unpin
- 🧪 Message hover actions match Stoat's (reply, react, edit, more; see the screenshot of the missing actions)

## Servers and channels (25 Oct 9:36 PM)
- 🧪 Right-click on a channel: mark as read, invite, mute, notifications, create channel or category, settings,
  delete, copy link
- 🧪 Right-click on a category: mark as read, create, rename, delete; right-click on empty space: create channel or
  category
- 🧪 Hover icons on channels (invite, settings) and voice channels (Stoat's voice channel hover actions)
- 🧪 The voice list in the sidebar under voice channels, like Stoat's
- 🧪 Channel settings: overview (icon, name, description, slowmode, mature), permissions per role, webhooks, delete
- 🧪 Missing server settings: system message channels, Discover submission, delete server
- 🧪 Roles in someone's profile when you open it inside a server (add or remove them if you're allowed), plus
  "Member since"
- 🧪 Per-server profiles: nickname and server avatar (through Stoat), plus banner, about me, decorations, name style
  and colours per server (kept on your sync servers; banners need sync server 1.2). Shown wherever you're seen in
  that server; "Use my main profile here" resets it
- 🧪 Discover loads (it didn't), with invite and bot links opening in Mustela's own dialogs

## Voice, video and screen share
- 🧪 The soundboard actually plays into the call (0.1.0: sounds can be added but don't play)
- 🧪 A different ring colour while a soundboard sound plays (not the talking green)
- 🧪 Speaking ring shows the moment someone talks (Stoat's is delayed too)
- 🧪 The call bar in the bottom-left is as wide as the user card, without mute and deafen (they're on the card)
- 🧪 Talking ring around your picture on the bottom-left card, and on people in the server member list (like Discord)
- 🧪 Option to hide people without video (not the streams you're watching)
- 🧪 Join and leave someone's stream in a call
- 🧪 Show when you muted someone for yourself, so it isn't confused with them muting themselves
- 🧪 Pop-out on Windows: not white, closable, resizable and movable (the Mac pop-out too)
- 🧪 Popping the call out and back in never reconnects (the main window keeps the call and draws the pop-out, like
  Discord and Vesktop)
- 🧪 Screen share like Discord/Vesktop: Mustela's own picker, no separate "is sharing" app or bar. App windows use
  Windows Graphics Capture, falling back to cutting the window out of its screen; going live waits for the first picture
- 🧪 Share just one app's sound (not only the whole system); screens only offer "No sound" or "Everything but Mustela"
- 🧪 Stream sound plays again (its player is a real file now, which the app's security policy allows)
- 🧪 A call that drops rejoins once by itself; screen share errors say why
- 🧪 Soundboard and menus open in the pop-out when used there
- 🧪 Call bar says where the call is: "Channel / Server" (or Direct message)
- 🧪 Call preview: while in a call and looking at another chat, the stream sits above the member list or DM profile
  and pushes it down (it stays when the list is hidden); resizable (mockup in the history)
- 🧪 Pause avatar decorations in calls when that person isn't talking (sidebar and call)
- 🧪 Linux distros whose WebKitGTK has no WebRTC can still join voice: the call runs in Rust (LiveKit's Rust SDK with
  WebRTC's own audio: microphone, speakers, echo cancellation), voice only
- 🧪 Screen share qualities match Stoat: 720p always, 1080p when your account's limit allows, 60 fps greyed out
  until Stoat supports it
- 🧪 Windows screen share: one continuous capture session (no pointer flicker, pointer shown, any window)
- 🧪 Stream sound in stereo at music quality, with a smoother player
- 🧪 Soundboard plays while you're muted (your voice stays off)
- 🧪 Emoji reactions removed from calls
- 🧪 Phones: the call fills the screen (chat one tap away), a "people in voice" list and Join before joining,
  two-across tiles, a floating control bar; a small draggable call tile (stream, or who's talking) everywhere else
- 🧪 Streaming must not lag, glitch or crash (Nev, Windows 10, 2019 mid-range PC)

## Profiles
- 🧪 A cropper for avatars and banners
- 🧪 Banner glitch fixed; banners taller so the hidden strip is hidden for Stoat and Mustela users alike
- 🧪 Banners show more on Stoat: the cropper picks the whole published picture (Stoat's centred band lands on it),
  with the 3:1 band Mustela's cards show marked
- 🧪 "View full profile" is a proper centred button
- 🧪 The banner strip can never run code (data only, size-checked, safe decoding)
- 🧪 Profiles refresh when you open a card or full profile (not a background job)
- 🧪 Name styles show consistently everywhere (chat, member list, voice list, friends), with bundled fonts
- 🧪 Click someone's picture or name on a card to open the full profile; "View full profile" button only in the DM
  side profile
- 🧪 Your own card from the bottom-left: right size, frames correct (measured after its opening animation), banner
  and bio shown; your picture or name opens the profile editor
- 🧪 Profile editor: "Profile for" main or any server (opens on the server you're in): server nickname and avatar
- 🧪 Nameplate preview in the profile editor
- 🧪 Emoji style setting applies everywhere: quick reactions, call reactions, statuses, soundboard
- 🧪 Dropdowns use Mustela's own menu (readable in dark mode); message hover bar is solid like Stoat's
- 🧪 Who can see my profile: Everyone / Friends / Friends and chosen servers

## Performance (29 Oct, Nev and the Linux friend)
- 🧪 Stardust (and other sparkle effects) much lighter
- 🧪 Effects can't freeze or crash the app (Linux too); name effects not glitchy
- 🧪 Pause decorations, GIFs and animated custom emoji when Mustela isn't focused
- 🧪 A Performance page in Mustela settings: GIFs and animated emoji on/off (separate from decorations), animation
  level, lighter in calls, keep animating in the background, blur behind menus
- 🧪 Title bar toggle (Mustela's or the system's) in Mustela settings; switching back to Mustela's no longer leaves a
  double title bar on Windows
- 🧪 Linux: occasional "Server rejected login" on open
- 🧪 Linux: profiles with animations crash the client
- 🧪 GIFs play only while on screen

## Look fixes from 24–25 Oct
- 🧪 Mac: clicking your profile in the bottom-left opens its menu (it didn't)
- 🧪 Blur behind pop-ups and menus when see-through is on (every desktop)
- 🧪 Bottom-left card blends in better (the same glass as the panels, hairline edge, soft shadow)
