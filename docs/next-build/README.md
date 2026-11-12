# Next build (after 0.1.6-build1): the to-do list

Pictures referenced here are in this folder. Do the start-up work first and measure before and after.

## 1. Fast, lightweight start-up (no long loading screen)
Scope: the start-up wait only. Big-server lag while using the app was fixed in 0.1.5-build5; keep that work.
- Show the app straight away from what's saved (servers, channels, recent chats), connect in the background with a small "Connecting…" indicator.
- Ask Stoat for a smaller start-up package (bonfire `ready=` fields); load big servers' members only when the server is opened.
- Remember the server config (`GET /`) instead of fetching it before every start.
- Split the app bundle: emoji data, call engine, settings, picture viewer and the like load on first use.
- Member and channel lists draw only what's on screen, where not already done.
- Start-up time and memory in the performance report; measure on phone and desktop before and after.
- Goal: as fast as or faster than Discord on mobile and desktop.

## 2. Profile cards open smoothly (phones and tablets)
- Save copies of **friends'** profiles only (not everyone's), so their cards open complete.
- Everyone's cards: the bio shows first so it looks already there; banner, decorations, mutuals and the rest fade in.
- Mutual friends and servers kept in memory only while Mustela is open (nothing written to the phone).
- Desktop stays as it is.

## 3. Compact channel rows, header-style categories (phones, tablets and desktop)
Picture: `channel-list-compact-headers.jpg` (left Mustela, right Discord).
- Channel rows a little more compact (less height and gap, like Discord's list).
- Category names bigger and bolder so they read as section headers (h2-like), with the arrow after the name.
- Desktop too (pictures: `channel-list-discord-desktop.png`, `discord-density-settings.png`; Discord is a reference for the feel, not something to copy). Keep Mustela's own density options as they are; just tune each so the channel list feels a little tighter and tidier, with the category headers keeping their bigger, header-like look at every density. Keep Mustela's own look.

## 4. UI glitches
- **Keyboard hides cards and dialogs** (phones and tablets): a card or dialog with a text box should move up above the keyboard so you can see what you type. Pictures: `keyboard-hides-card-phone.png` (nickname card under the blur), `tablet-keyboard-hides-dialog.jpg` ("Rename category" pushed under the keyboard).
- **Typing in a chat on tablets**: the keyboard covers most of the screen; the message box and the newest messages should move up with it and fit, like Discord's, smoothly and without the big empty space. Pictures: `tablet-keyboard-mustela.jpg` (now), `tablet-keyboard-discord.jpg` (how it should behave).
- **Voice call tile cut off at the top**: the outline around your tile is clipped at the top. Picture: `vc-tile-top-cut-off.png`.
- **The app flashes when you switch back to it** (it was only in the background, never closed).
- **"Viewing older messages" card**: slightly narrower than the message box on all platforms; on phones a little bigger and easier to tap. It sometimes floats in the middle of the chat covering messages (picture: `older-messages-bar-floating.png`); it must always sit right above the message box, stuck to the bottom of the chat. **On phones and tablets, replace the bar with just a round, touch-friendly down arrow** (bottom right, above the message box, like Discord's jump-to-bottom button) that jumps to the newest messages; desktop keeps the bar. With files attached and waiting to send, the bar sits awkwardly on top of the attachment previews (picture: `older-messages-bar-over-attachment.png`): keep the bar, but join it neatly to the top of the attachment tray so they look like one piece (same width, no overlap). Sending a message must always jump to the newest messages (the bar then goes away by itself); check that it does.
- **Status text** on the bottom nameplate and in your card: a little bigger, closer to the chosen text size (not quite as big), easier to read.
- **Settings > Notifications wording on phones and tablets** (picture: `notifications-settings-phone.png`): "Desktop notifications" should say "Notifications"; the Unread badge hint should say "Mention count on the app icon" (no "window title" there). Computers keep their wording.
- **The message hold menu (phones and tablets)** (pictures: `hold-menu-mustela.png` now, `hold-menu-discord.png` Discord's):
  - It slides up slowly and choppily; it should pop up as quickly and smoothly as the other cards. Check what makes it heavy (blur behind it, the reaction row, the long list, the open animation) and keep the animation short (transform only).
  - Open **halfway up**, like the other hold menus; drag up for the rest.
  - **Reaction row with your emoji**: your favorite and most-used emoji instead of six fixed ones, plus a button at the end that opens the full emoji picker to react with anything.
  - **Double tap a message to react**: a quick reaction with one chosen emoji (like Discord's "Double tap a message to 😂 · Edit" line under the reaction row, where you change which emoji). Double tap again removes it. Shouldn't slow down single taps (links, pictures, names still open straight away).
  - Options grouped into rounded blocks like Discord's (most used first: Edit, Reply…; then copy actions; then Delete).
  - **Works like the emoji/GIF card** (from chat): it comes up from the bottom and pushes the chat up instead of covering it, so the message you held stays in view above the card with a soft highlight, and you always know which message you're acting on. Flows smoothly, the same motion as the emoji card. While it's open you can still long-press the message's text to select part of it and use the phone's own copy handles and menu (Copy, Select all, Share). Tapping the chat above or dragging the card down closes it and the highlight fades.
- **"Keep animating in the background" also pauses GIFs, animated emoji and videos**: today it only pauses Mustela's own animations (decorations, nameplates, profile effects) when another window is in front; GIFs, animated emoji and videos keep playing. With it off, show their still frame and pause videos while Mustela isn't in front, and resume when you come back. Hint text says exactly what it pauses. (`src/lib/render/loop.ts` gates; `data-still-gifs` already exists for the GIF setting.)
- **Mic and speaker menus on desktop cover the nameplate** (pictures: `audio-menu-output-mustela.png`, `audio-menu-input-mustela.png` now; `audio-menu-output-discord.png`, `audio-menu-input-discord.png` Discord's): the menus from the arrows beside the mic and headphones open over the bottom nameplate. Open them fully above it, like Discord's, so the nameplate stays visible.
- **Long names and the BOT tag** (pictures: `names-bot-tag-cut.png`, `names-member-list.png`, `names-long-cut.png`): long names get cut off without "…", and the BOT tag gets pushed off the edge ("AutoMod Testing B…"). Names shrink and end in "…"; tags like BOT (and other badges next to a name) always stay fully visible. Some names also wrap onto a second line instead (picture: `names-wrap-pinned-dm.png`, a pinned DM: "My Love Bug Bean 💚" wraps and pushes the status down): names stay on one line everywhere. Where it goes wrong (from tablet photos): the DM list is right on tablets (`names-dm-list-tablet-ok.jpg`, "My Love Bug Bean …"), so the wrapping is the phone layout only; the **member list** cuts names off with no "…" on tablets too (`names-member-list-tablet-cut.jpg`: "MARS", "SKI-Brano-6942…"), while the status line under each name already gets "…". Likely because styled names (emoji, gradients, name styles) are made of several pieces and the "…" isn't applied to the whole name. Check phone, tablet and desktop. Apply it to **names in lists and rows only**: member list, DM list (pinned and normal), voice channels, message headers, mentions. **Not** on profile cards or the full profile, which show the full name (wrapping there is fine). The DM name at the top of a chat already does this; leave it. Don't add "…" to other text.
- **Space under the "Messages" title on phones**: the search / Friends / + row sits right under the title; add a little padding between them (screenshot in chat).
- **Menus for people talk about people, not servers** (picture in chat: right-clicking a DM shows "Mute channel", Notifications "Use server default", "Copy channel ID"): a DM is a person. Word every DM and group-chat menu for what it is ("Mute conversation", notifications without a "server default", "Copy user ID", Mark as read, Close DM…), like Stoat's, and offer what makes sense for a person (Profile, Message, Call, nickname, friend/block, Copy user ID). Check every user menu: DM list, member list, message author, mentions, voice channel members, friends list, profile cards.
- **Status dots a little bigger and easier to see** (pictures in chat: DM list, member list, server tooltips, offline members): the online/idle/busy/offline dot on avatars is tiny; make it a bit bigger with a clear ring around it, on every avatar (DM list, member list, messages, profile cards, the user bar), phones, tablets and desktop.
- **Input sensitivity like Discord's** (pictures in chat: Discord's desktop and phone Voice & Video pages): one slider where the track is yellow below your threshold and green above it, with your live mic level running along it, and the handle sets the threshold; "Decide for me" (auto) keeps working. Same on desktop, phones and tablets.
- **Hold cards centred on wider screens** (tablets): the message hold card is now a centred card instead of stretching across the whole screen; do the same for every other card that comes up from the bottom (hold menus on people, channels, servers, DMs, dropdowns), and check them all on tablets held both ways.
- **Small swipes on phones**: a swipe too short to open the side panel shouldn't move the chat at all. Only start the slide animation once the swipe passes the point where it will actually open.
- **Member list doesn't show who's talking** (picture in chat: the member list beside a channel): people in a voice call get the green speaking ring on their picture in the member list too. Not needed there; the speaking ring belongs to the call screen, the voice channel rows and the mini view only.
- **Tablets use the phone's mini view and picture-in-picture**: same look and feel as on phones (just the pictures, no names under them, the phone's sizes and gestures), instead of the desktop-style mini view.
- **Mini view and picture-in-picture don't show you talking** unless you're alone in the call: your own picture never lights up when someone else is there too. Your picture should light up whenever you talk, however many people are in the call (like it already does on the call screen).

## 4a. DM header and emoji card
- **DM header buttons a little more compact on phones** (picture: `dm-header-buttons-phone.png`): call, video, pin and search take so much room the person's name shows as "N…". Tighter, like Discord's, so more of the name fits.
- **Bigger names in messages** (DMs and channels, phones and tablets; pictures: `emoji-card-mustela-phone.png` vs `emoji-card-discord-phone.png`, and `dm-header-buttons-phone.png`): the sender's name above messages is small next to the message text; make it bigger, closer to Discord's, with the time staying smaller beside it.
- **Backspace button in the emoji card** (pictures: `emoji-card-mustela-phone.png` now, `emoji-card-discord-phone.png` Discord's, delete key at the right end of the category bar): delete the last character or emoji without going back to the keyboard.
- **Holding an emoji to favorite it doesn't work on phones**: the hold timer and Android's own long press (which sends a right-click) both toggle the favorite, so it's added and removed straight away. A hold must toggle once only (the right-click is ignored when the hold already did it, and the other way round); keep the vibration and the "added to favorites" note. `src/ui/chat/overlays.tsx`, `Btn` in the emoji picker.
- **Emoji name card stuck over the hold menu** (picture: `emoji-name-card-over-hold-menu.png`): holding a message that has an emoji in it also opens the emoji's name card (":people_hugging:"), a desktop hover card, and it stays on top of the hold menu, covering items. On touch, the name card should only appear from a tap on the emoji itself (or not at all), and it must close when a menu opens.
- **Tablets: opening the emoji card pops the keyboard up**, because the emoji search box gets focused straight away. Don't focus the search box on open on phones and tablets; only when you tap it.

## 4d. Messages on phones, and text sizes everywhere
- **No hover toolbar on phones and tablets** (picture: `hover-toolbar-on-phone.png`): the reply / react / edit / delete / … bar that appears on a message is a desktop thing; holding a message already gives all the options. Don't show it on touch.
- **Editing a message on phones** (pictures: `edit-box-overlaps-phone-1.png`, `edit-box-overlaps-phone-2.png`): the edit box and the regular message box are drawn on top of each other, so the text, placeholder and buttons overlap. While editing, the edit box takes the message box's place (hide the regular one), like Discord.
- **Message box height (all platforms)**: one line tall by default, and it only grows when the text actually wraps onto more lines (then back down when it doesn't). It shouldn't get taller than the text needs. Maximum: about 5 to 7 lines on phones and tablets, 7 to 9 lines on desktop (picture: `message-box-9-lines-desktop.png`, 9 lines looks right); past that, the box stops growing and scrolls inside. Picture: `message-box-grows-desktop.webp`: the box is empty, but the placeholder ("Message @Ruykon (Nevu/Ruy)") wraps onto two lines and makes it taller. The placeholder stays on one line and ends in "…" when it doesn't fit; only typed text makes the box grow.
- **Send button on phones and tablets** (picture in chat: the light square with an up arrow at the right end of the message box): doesn't look like it belongs. Redo it to fit the message box: round, in the accent colour, the same height as the other buttons in the box, lined up with them, clearly dimmed while there's nothing to send. Check it in light and dark themes and with see-through panels.
- **Text sizes that feel right everywhere (accessibility pass)**: typed text in the message box is smaller than the messages; together with the other size items on this list (names in messages, status text, settings headers, category headers) go through every screen so sizes look balanced and all follow the chosen text size. Check at the default size and at large sizes (Accessibility > text size, and the phone's own large text) on phone, tablet and desktop: nothing cut off, overlapping or out of proportion.

## 4g. Categories and pins
- **"No color" for pinned groups**: favorites categories already have it; the pinned DM groups' Color menu doesn't (`src/ui/pins.ts`, the pinned group menu). Same "No color" option there.
- **Empty categories stay visible**: in Favorites, Pinned, servers' channel lists, and anywhere else with categories, a category with nothing in it is hidden until you start dragging something. Always show it (with a faint "Empty" hint or just its header), so you can see it, rename it, or drop things into it.

## 4h. Link previews (embeds)
- **Posts with several pictures show only the first**: a Tumblr post says "2 images" in Mustela's card but shows one; Discord shows all of them (side by side in a grid) and the viewer swipes between them. Show every picture in a grid like attachments do (2 side by side, 3–4 as a grid, "+N" past that), each opening the viewer at that picture with the rest to swipe through. Check Tumblr, Twitter/X (fxtwitter, vxtwitter), Bluesky, Instagram (kkinstagram), Reddit and any embed that carries more than one image or video.
- Go over the other embed types while there (video, YouTube, GIF services, plain websites) so each shows what Discord would.

## 4i. Notifications on phones and tablets (act like a normal chat app's)
Pictures: `notif-mustela-1.png`, `notif-mustela-2.png`, `notif-mustela-3.png`, `notif-mustela-4.png` (now); `notif-discord-1.png`, `notif-discord-2.png`, `notif-discord-3.png`, `notif-discord-4.png`, `notif-discord-5.png`, `notif-discord-popup.png` (Discord's). **Research and the full plan: `notifications-research.md`** (how Telegram, Discord and other chat apps do it: per-chat messaging style, grouped with one sound per burst, conversation shortcuts for Android's Conversations section and bubbles, Reply / Mark as read without opening the app, channels per kind). Study how Stoat's official apps and other open-source clients (Vesktop, etc.) handle notifications; copy behaviour only, never code.
- **Why it looks like this now**: while Mustela is still open in the background, the page sends notifications through Tauri's basic notification plugin (`src/lib/notify.ts` → `sendNotification`), not the chat-style ones MessageWatch.kt posts when Mustela is closed. Route all phone and tablet notifications through the native path instead (same as MessageWatch.post).
- **Mustela's own icon**: the status bar and notification show a generic "i"; use Mustela's notification icon (the white mask, `ic_notification`), and the sender's picture large, like Discord's.
- **Clearly Mustela's, grouped per conversation**: "Mustela" with the conversation name; one notification per chat with the latest messages stacked (Android's messaging style), not separate plain ones.
- **Expanding shows the messages**: tapping the arrow currently shows only the name; show the full recent messages.
- **Tapping opens that chat at that message**, from the app in the background or closed. (Check desktop too: clicking a notification should open the chat on Windows, macOS and Linux.)
- **Actions**: Reply (type right in the notification), Mark as read, and Mute (like Discord's).
- **No in-app sound on phones and tablets for messages**: the phone's notification sound is the only one; Mustela's message sound plays only on desktop (or never when the notification already makes one).
- Reading the chat anywhere (phone or another device) clears its notification.

## 4b. Settings on phones
Pictures: `server-settings-phone-frames.jpg` (frames from `server-settings-phone.mp4`; top rows: Server settings now, bottom right: your own Settings, which works right).
- **Server settings (and channel settings) work like your own Settings on phones:** the menu fills the screen; tapping Overview, Channels, Discover, Your profile here, Emojis, Invites… opens that page full screen with a back arrow to the menu. Right now the page is squeezed into a strip at the bottom of the menu.
- **The whole flow, for reference** (video: `server-settings-flow-stoat.mp4`, frames: `server-settings-flow-stoat-1.jpg`, `server-settings-flow-stoat-2.jpg`; Stoat's Android app, behaviour only): Server Settings menu → Channels (grouped by category) → tap a channel → that channel's own menu (Overview, Delete Channel) → Overview page (icon, name, description, Mark as NSFW) → back arrow at every step returns one level. Mustela's server and channel settings on phones should move through the same levels, each full screen.
- **Server settings > Channels with categories** (picture: `server-settings-channels-stoat.png`, Stoat's Android app; copy the behaviour only, not its code): channels grouped under their categories ("Uncategorised" first), each category showing its channel count with a ⋮ menu (**Create channel** in that category, **Rename category**, **Delete category** in red; picture: `server-settings-channels-stoat-menu.png`) and a drag handle; channels with a drag handle to reorder them or move them between categories; a + button to add a channel or category. Changes save to the server's real category order (all platforms, touch-friendly on phones).
- **Bigger section headers in Settings on phones:** "User settings", "Client settings", "Server", "You", "Customisation", "People" are tiny; make them bigger and easier to read (same header feel as the channel list categories in item 3).

## 4c. Server profile editor without a sync server
- When editing your profile **for a server** and no sync server is linked, only show what Stoat itself keeps per server: **server nickname** and **server picture**.
- Hide (or grey out) the parts that need a sync server: this server's banner, about me, decorations, name style and colours. Stoat has one banner and bio per person, so they can't ride in the banner strip.
- In their place, one short line: "Link a sync server to give this server its own banner, about me and look", linking to Settings > Mustela sync.
- With a sync server linked, everything shows as now. The main profile editor is unchanged (its look fits in the banner strip).

## 4e. Check that every feature and button works, on every platform
- **Start with the picture/video viewer on phones** (picture: `viewer-save-share-phone.png`): Save, Share and Open in browser in the ⋮ menu don't work on Android (desktop seems fine). The wiring is in place (`media_file` command in NativePlugin.kt `mediaFile`, permission granted, `opener:default` for the browser), so it fails inside the Android code at run time: debug on a device (download of the file, MediaStore save, share sheet, error shown to the user instead of nothing).
- **Then a full pass**: write a checklist of every feature and button (menus, settings, profile editor, calls, screen share, PiP, uploads, camera, links, invites, notifications, updater, search, pins, scheduled messages, friends, server and channel settings, Discover…) and go through it on phone, tablet and desktop. Automated checks cover the screens (the demo sweep); the native parts (saving, sharing, opening links, camera, notifications, calls, updater) need a real device. Anything that fails gets fixed or reported with a clear message, never silently doing nothing.

## 4f. Appearance: saved themes, gradient glitch, per-account look
- **Saved themes** (like Windows themes): save your current appearance (theme, colours, gradient, panel opacity and blur, backdrop, text size, density…) as a named theme; update it later; apply any saved theme to switch. Themes sync across your devices. The background **picture** is kept on the device it was set on, so when a theme is applied on a device that doesn't have its picture: everything else applies, the current background stays, and it asks you to pick the picture again (one tap to choose). If a sync server is linked, the picture can travel with the theme instead.
- **Gradient themes glitch** (picture: `gradient-theme-blocks.png`, the lavender one; all gradient themes do it): the background shows blocks and seams instead of one big smooth gradient across the window. Find where the gradient is drawn per piece (panels, tiles, rail) and make it one continuous gradient behind everything.
- **Look-only settings per account, not per device**: the background, backdrop and other appearance settings kept on the device are currently shared by every account signed in on that device. Make them per account (each account starts from what's there now, once). Device things stay shared: microphone and speakers, call engine, title bar, close to tray, notifications on this device.

## 5. Streaming card on profiles
- Streaming LIVE tag, the voice channel, who's in it, Join Voice.
- Picture: one frame per person per session (first time you open their card or see them in the voice panel's hover card), reused until Mustela restarts. Only possible when you're already in that call; otherwise no picture.
- Optional later (user's decision): streamers on Mustela share a small snapshot through the sync server.

## 6. Recent photos grid in the + card (phones)
- Your latest photos inside the + card like Discord's, with the camera tile. Needs a photo permission and new Android code.

## 7. Desktop GIF tab (only if it still crashes or lags in 0.1.6-build1)
- Play GIFs only while on screen, pause the rest.

## Ideas not decided yet
- Mic and speaker menus with more in them, like Discord's (see the Discord pictures above): output volume slider in the speaker menu; input volume slider and a live mic level bar in the mic menu; the device list as a sub-menu.
- Instant push notifications through your own Firebase project and the sync server (the background check stays as the fallback).
- Hide leave and join sounds from friends who use Mustela when you switch devices.

## 8. Round 2 (after testing the first 0.1.7-build1): all done, see device-checklist.md
Pictures: `r2-*.jpg` (phone), plus desktop screenshots in chat (message box, DM list vs Discord's, settings top bar, Discord's mic menu with Input Volume, older-messages bar).

**Desktop**
- Switching servers sometimes needs two clicks on the icon.
- Message box: send, attach, timestamp, GIF and emoji buttons centred on the box's middle line.
- Long names: "…" and no scroll bar (the DM list showed a scroll bar under "ConnerToons …").
- The message box (where you type) could be scrolled on a single line, with a scroll bar on Windows; same on phones. It should only scroll once the text reaches its line cap.
- Slowmode on a channel messes up the jump-to-recent-messages bar (the slowmode chip pushes it).
- DMs a little more spacing between people (desktop); profile pictures in the DM list a tad smaller (phones).
- DM list: pinned group and Direct messages closer together (like Discord's).
- Mic and headphone menus: volume sliders (Input Volume / Output Volume) like Discord's, the device as a sub-menu, Input profile.
- Reaction animation when you react (desktop too).
- "Delete message?" as a Discord-style pop-up.
- Settings: spacing at the top of some pages (the "New text channel" row runs into the header), on mobile and desktop.
- Settings search actually finds things (it barely works), and its box is the normal text-field size on mobile.

**Pins and categories**
- "No color" for a pin group doesn't stick (always goes back to Amber).
- Delete pin group.
- Don't add a default category to servers you manage; "Uncategorised" stays as it is and channels can be moved back to it.
- Pinning channels: only from the menu (no drag to pin), one pinned spot without groups.

**Phones and tablets**
- Nickname (and other prompt) boxes shrink to almost nothing (`r2-nickname-box-shrinks.jpg`).
- Swipe back still glitches a little.
- Every hold card (DMs, channels, servers, people) follows the new message hold card's look: grouped blocks, centred on tablets, opening halfway, not scrolled to the top (`r2-hold-cards-should-match.jpg`).
- Holding: the option under your finger gets highlighted when the card opens; it mustn't.
- Tapping a message highlights it; it mustn't.
- Selecting text in a held message: use the phone's own copy menu (Copy, Select all, Share), with the hold card staying open.
- Double tap to react: works everywhere on the message (only worked on the right side of media), snappy, with an animation.
- Emoji/GIF card: smoother, and switching between Emoji and GIFs slides instead of redrawing; the delete key stands out more.
- Emoji list: tapping a server's emoji (above where you are) doesn't jump to it.
- GIFs slow or not loading (first time after opening the app).
- Gestures easier and smoother overall; every card can be dragged up or down from anywhere on it (not only the little bar), like a scrolling card.
- Less space between the message box and the messages.
- + card (`r2-add-media-card.jpg`): opens like the other cards (not high up), no frame around the photos, no empty space at the bottom; the buttons scroll away with the photos and the card grows as you scroll up; as many photos as fit.
- Server settings > Overview on phones looks bad (`r2-server-overview-phone.jpg`): icon, banner and their buttons laid out properly.
- Tablets with the keyboard up: only the messages and message box move; the user bar, call bar, side list and member list stay put behind the keyboard (except while searching).

**Everywhere**
- "Keep animating in the background" off: GIFs and animated emoji still play when you switch windows; "Play GIFs and animated emoji" off: they still play.
- Input sensitivity shows your live mic level all the time on that page (not only during the mic test).
- Server emoji: edit (rename) if Stoat allows it.
- Viewer Save, Share, Open in browser still don't work on Android (see how Stoat's Android app does it).
- Link previews with several pictures still show one.
- Reference Stoat's open-source code (behaviour only) and other open-source apps; phones and tablets should feel buttery smooth.

## 9. Round 3 (after testing round 2): all done, see device-checklist.md
Pictures: `r3-*.png/jpg` (app screens and Discord's for reference). The gallery and search-media screenshots from chat aren't saved here (they show real people's photos).

**Phones**
- Rename / nickname dialogs: the box now stays the right size, but its card behind is broken (only the title has a background, the rest floats). Give it the whole rounded card again (`r3-nickname-dialog.png`, `r3-pin-group-dialog.png`).
- Search in a chat broke again: the message box shows over the results (`r3-search-composer-over.png`), and the Media tab's pictures overlap each other.
- + card photos: bring back rounded corners and a tiny gap, like the search Media tab. Add a view toggle: the plain grid, or grouped by date (Today, Yesterday, Nov 6, …) like a gallery app. A scroll handle on the side that you can hold and drag, showing the month while you do.
- Menus, cards and scrolling: smoother, no hiccups.
- Swiping back from a channel or DM still feels a little wonky.
- Friends page on phones is broken (`r3-friends-phone.png`: the filter list floats under the header).

**Desktop and phones**
- Check the search Media tab on desktop too.
- Tumblr posts with two pictures still show one (fxtumblr hands out a single rendered picture of the post); X posts work now.
- Spoilers: pictures you uncovered in the chat still show covered when you open them in the viewer and swipe to the next one (they stay covered only if you didn't uncover them).
- The + next to "Direct messages": remove it on phones (there's already a + at the top). On desktop it should do what the phone's top + does (one person: a DM, more: a group).
- Home search actually works, like Discord's: on phones a search screen (Recent, People split into Friends and Server members, Messages, Media); on desktop a "Find or start a conversation" bar above the DM list that opens a quick switcher (`r3-discord-*`). Message search covers DMs (like Discord's "Search in DMs").
- Emoji/GIF card on phones: switching between Emoji and GIFs slides sideways inside the same card (no card reload); other screens with tabs (like search) slide between tabs too.
- Home search keeps the Mustela look: same header, pill tabs and rows as the chat search on phones.
- Home search: filters for results like the chat search has (from, in which DM, has, when).
- Home search filters as a "Filter results…" menu from a filter button (From a specific person, In a specific DM, Has specific data, Mention someone, Sent on / Before / After a date, By author type), active ones as removable chips (`r3-discord-filter-results.png`).
- Home search Recent tab: a Photos & Media preview with "View all" under the history; Pins, Links and Files tabs too (Discord's Search in DMs).
- Chat search results look like messages: name on one line with "…", short dates (25d, 3mo), a bigger picture, text indented beside it (not under it).
- Desktop message box: the + and send buttons sit low; centre them on the box.
- Saved themes also keep the Window settings (window material) with the theme.
- Desktop settings: sticky page headers (like phones).
- Pin groups can be dragged to reorder them.
- A group's or category's colour colours its name (instead of a dot).
- Edit profile on phones: the close button stays at the top while scrolling.
- New groups and categories start with no colour.
- Server icons and banners get the crop tool like profile pictures.

## 10. Round 4 (after testing the third pass): all done, see device-checklist.md
- Opening a DM or channel you're up to date in sometimes lands on "You're viewing older messages" and needs Jump to present (some people and some channels, ones with link cards and pictures).
- Mustela sometimes shows a chat as unread when the last message is your own.
- Server icons do a double bounce on hover (the side bar wobbles with it) and the click doesn't go through until it settles.
- A favourite GIF (media1.tenor.com/….gif) sends as a link with the link text showing, and keeps playing when tabbed out.
- Tumblr post with two pictures still shows one. Discord shows both, from Tumblr's own picture links (64.media.tumblr.com/…/s2048x3072/…).
- Mark as unread on a message: going to another chat and back doesn't show it from that message (it looks read).
- Tablets (sideways): keyboard up for search still shows the message box and user bar above it; typing a message lifts the user bar too (only the chat and the box should move); Jump to message from search doesn't close the search; search should work like the phone's (the header bar is thin, Home's opens the desktop quick switcher). A tablet is touch first: side by side like desktop, but everything you touch works like the phone. Home search sits where the chat is, like a chat's search.
- + card photos four across, with multi-select (like Discord's); cards keep a little top padding while scrolling so content doesn't run into the card's edge (all cards).
- Phones: tapping the "new messages since" bar sometimes didn't jump.
- Phones: tap an attached picture before sending to preview it, with Mark as spoiler and Remove there (like Discord's), instead of the tiny buttons.
- Banner crop: what you crop isn't what your card shows (it was your old banner, kept for a day); let the picture move all the way up or down within the crop (still never showing the profile strip).
- Search in New message doesn't work on phones.
- Play Protect: "Harmful app blocked" when installing this build's APK (new; see the answer in chat).

## 11. Round 6 (after testing the fifth pass): all done, see device-checklist.md
- Edit profile shows the old banner until you leave the screen.
- Settings search on phones looks broken (shrunk to an icon, can't type).
- The bar says 13 new messages, the badge 3: the badge counts only their messages.
- Search results should follow Accessibility text sizes.
- The open DM in the list should show their name effect, like the nameplate.
- Big servers: an option to keep profile effects still in text channels and member lists (cards still play). In Performance; mentioned in the release notes.

## 12. Round 7: all done, see device-checklist.md
- New message dialog doesn't follow the other dialogs with the keyboard up (shrinks to its title).
- Jumping to a message from search puts it at the bottom of the screen (should be centred like pins); same in a chat's search and In context.
- In context glitches with pictures (full size, off the side; the message pushed out of view), including pictures on the messages next to it.
- Chat search on phones: From lists no one until the search box has been tapped.

## 13. Round 8: all done, see device-checklist.md
- Taking a photo closes the DM (looks like a restart), even when cancelling the camera; only photos, not videos. Use the system / default camera.
- Photos and videos taken in Mustela shouldn't be saved to the phone.
- Put the X back on attached photos; the preview card should open showing the spoiler toggle and Remove (not scrolled); show the photo/video at full resolution.

## 14. Round 9: all done, see device-checklist.md
- Scrolling on phones isn't smooth (and up/down feels a little wonky); a hair too fast. Keep the speed, maybe an option in Performance.
- Opening links from video embeds (YouTube) gets stuck in a full-screen website; links in embeds should open in the browser.
- YouTube's "This channel got money or free things" box in the player can't be hidden (YouTube draws it inside its own player).

## 15. Round 10: all done, see device-checklist.md
- Hide server settings (gear and menu) in servers where you can't change anything.
- Channel pictures don't show in the channel list.
- No slowmode setting (it was there for text channels only).
- Settings pages need room at the top (channel settings "Channel" touches the top).
- Role icon closer to the name and lined up with it.
- The X on Edit profile doesn't work.
- Custom colours for folders, categories, pin/favorite groups.
- A friend's online status didn't update until restart.
- Replying to a message with a custom emoji says ":emoji:".
- DM side card: decoration or profile effect breaks and moves with the chat's scrolling.
- Activity on cards like Discord's (soft box, themed buttons, bio above it); full profile: no activity on its card, tabs like the others.
- "View full profile" at the bottom of the DM side card.
- "In voice" in the same kind of box, with Join voice / Open voice (tidier layout: a tile of who's in the call).
- Pronouns next to names in messages, like the pill on the card.
- Home voice card on phones: same tile as profiles (fits the square, +N, friends first); tapping it opens a card like Discord's that matches Mustela's voice screen.
- Flip the status bubble.
- Marking a DM unread shows an odd number on its picture; show no number for ones you mark unread.
- App icon beside people in voice lists (what they're playing).
- @everyone doesn't look like a mention.
- Bot embeds (GitHub) show raw markdown; joined/left lines should show the person (tap for their card) like Stoat.
- Android notifications: often only arrive once the app is opened; tapping one opens the app but not the message.

