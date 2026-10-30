# Mustela rebuild plan

Started 29 October 2026. Mustela is to Stoat what Vesktop is to Discord: Stoat's features, plus a look and extras of
its own, and lighter on RAM, CPU and GPU than Discord.

## Decisions

- **Base: 0.1.0** (`mustela-0.1.0-best_version_so_far.zip`). It's the version that works best. The "newest" zip is
  broken and is used **only as a list of features to bring back**. Its code is not copied; each feature is rebuilt
  and tested here.
- **Architecture: Tauri 2, Rust core, web interface.** One interface (SolidJS) for every platform, so the look, layout
  and features are the same everywhere. Rust takes on more of the work over time, wherever that actually saves memory
  or CPU (see phase 3). A fully native Rust interface was considered. It would use less memory, but every screen would
  have to be redrawn, the look would change, and iOS support is weak. It can come later, because the Rust core makes
  that move smaller.
- **Phones: Tauri mobile, the same as 0.1.0.** We don't switch to separate Kotlin/Swift apps. The problems people hit
  on phones (back button, cut-off screens, padding, calls) are fixed one by one in phase 2. Native code is added only
  where a phone needs it (calls, screen share), through the existing `mustela-native` plugin.
- **Delivery:** zips for now, with no GitHub yet. CI (`.github/workflows/ci.yml`) is ready for when the new
  repository exists.

## Compatibility contract with 0.1.0 (don't break)

People on 0.1.0 upgrade to this version, and some will use both for a while. These must stay readable by 0.1.0:

| What | Where | Rule |
|---|---|---|
| Synced settings | Stoat sync key `mustela:settings`, `v: 3` | Same key, same fields. 0.1.0 drops fields it doesn't know and overwrites last-write-wins, so **new settings go under a new key** (`mustela:settings-ext`), never this one. Pinned by `src/lib/sync/compat.test.ts`. |
| Stoat's own keys | `ordering`, `server-folders`, `notifications` | Same shapes as Stoat's client. |
| Banner profile | `src/lib/marker` (magic `a7 5c`, ≤24 bytes, CRC16), pack version 2 | Decoder keeps reading v2. A new pack version must still be written as v2 when the profile fits. |
| Sync servers | protocol `v1` (`/v1/link`, `/v1/profile`, `/v1/activity`) | Additions only. |
| Local data | app identifier `app.mustela.client` | **Kept.** The identifier decides where the desktop app keeps sign-ins and local sounds, and which Android app gets updated. Changing it to `com.mustela.stoat` would sign everyone out and install a second app on Android. See the open question below. |

## What's done in this first pass

- New project from 0.1.0, with a CI workflow and `.gitignore`. Type check, all tests (196) and `cargo check` pass on
  Linux; `cargo check` also passes for Windows.
- **Android build fixes:**
  - The `autostart` permission is only listed for desktop.
  - The old `~/.gradle/init.d/jitpack.init.gradle` is turned off automatically (it caused the
    *"prefer settings repositories"* failure).
  - JitPack is declared inside the project instead.
- **Build script:** asks for the **version number** and the **GitHub repository** for updates (or takes `--version` and
  `--repo`). It writes the version into package.json, tauri.conf.json and Cargo.toml, and remembers the repository in
  `.build.json`.
- **Updater** (`src-tauri/src/updater.rs`, `src/ui/updates.tsx`):
  - Checks that repository's latest GitHub release on start and every 6 hours.
  - Only downloads from that repository, and the file must match GitHub's SHA-256.
  - Windows runs the installer quietly and restarts. The AppImage swaps itself and restarts. The .dmg and .deb are
    saved to Downloads and opened. Android and iOS open the release page.
  - Settings › Advanced › Updates has Check now and an auto-check switch, and a card shows when an update is out.

## Feature audit: 0.1.0 against the full list (FEATURES.md)

✅ in 0.1.0 · 🟡 partly · ❌ missing (to bring back)

**Chat**
- ✅ Stoat markdown, replies, reactions, edit/delete, pins, search, attachments, embeds, link and invite cards, typing
- ✅ GIFs (Gifbox) and favourites that sync; emoji packs; big emoji-only messages; emoji hover info
- ✅ Autocomplete for @people and :emoji:
- ✅ Drag-and-drop, paste and upload progress
- ✅ Inbox, Saved Notes above DMs, DM pin groups, Discover, server folders and order, read state and notifications synced
- ❌ Drafts per channel and DM (kept after a restart), and attachments that stay with their channel
- ❌ Formatting toolbar on selected text, and Ctrl/Cmd+B, I and U
- ❌ Mention, channel, role and message-link chips in the text box (sent messages keep the original look)
- ❌ Autocomplete for #channels, roles, @everyone and @online
- ❌ Spoiler toggle on attachments (`SPOILER_`)
- ❌ "N new messages since…" bar with Jump and Mark as read, and the red New line; DMs open at the first unread
- ❌ Servers reopen your last channel; Home reopens your last DM (this session only)
- ❌ Unread DMs as avatars under Home
- ❌ Inbox as mentions only, with click-to-jump
- ❌ Read-only notice, slowmode countdown, visible edit/delete/reaction errors, loading missed messages after a reconnect
- 🟡 Notifications: per server and channel exist; respecting Busy/Focus and skipping blocked people is missing

**Servers**
- ✅ Server settings: overview, icon and banner, channels, roles, emoji, members, invites, bans
- 🟡 Right-click menus: message, person and server exist. Missing: the channel menu (invite, mute, notifications,
  settings, delete, copy link), the category menu and the empty-space menu
- ❌ Channel settings: overview, slowmode, mature, permissions per role, webhooks, delete
- ❌ Server settings: Discover submission, system message channels, delete server
- ❌ Invite and settings icons when you hover a channel
- ❌ Roles and "Member since" on profiles inside a server; per-server banner, bio and decorations

**Voice, video, screen share**
- ✅ Call view with tiles, a big stream and full screen; DM calls; pop-out; per-person volume up to 200%; stop
  watching; speaking rings; soundboard and entry sound; input sensitivity
- ❌ Call preview above the member list or DM profile (from the mockup)
- ❌ Hide people without video; a grey icon for people you muted for yourself
- ❌ Mustela's own screen-share picker (no "is sharing" bar), sharing one app's sound on Windows, 720p default
- ❌ Linux without WebRTC: Rust voice engine
- 🟡 Phones: calls in the background and call volume (the native plugin exists, but neither has been checked on a phone)

**Profiles**
- ✅ Profile editor with live preview; decorations, effects, frames, nameplates, name styles; ratings; banner marker
- ✅ Bottom-left card with status; activity from game detection and Rich Presence alongside Discord
- ❌ Cropper for avatars and banners; taller 960×480 banners so the strip is hidden; size-checked decoding
- ❌ Profiles refresh when opened; a failed lookup retries
- ❌ Other people's name styles everywhere (chat, member list, voice list, friends), with bundled fonts
- ❌ "Who can see my profile" (Everyone / Friends / Friends and chosen servers)

**Performance**
- 🟡 Shared animation loop and rating budget exist. Missing: a cap of 10, pausing in the background or when unfocused,
  lighter in calls, decorations in calls moving only while that person talks, Stardust particles made once, still
  frames drawn once
- ❌ Settings › Mustela › Performance page: animations, lighter in calls, keep animating, GIFs and animated emoji,
  blur, title bar switch
- ❌ Linux defaults (no blur, reduced animation, DMA-BUF off) and the login retry after network hiccups

**Desktop**
- ✅ Tray with call state, closing to the tray, single instance, start with the computer, Mica/Acrylic/Vibrancy,
  thin title bar with inbox, Program Files install, AppImage self-install
- ✅ Updater with version and repository from the build script (done in this pass)
- ❌ Remembering window size and position (window-state)

**Phones**
- ❌ The Android back button closes the open screen instead of the app
- 🟡 Safe-area padding (only partly), full-screen inbox, simple bottom bar

## Phases

1. **Phase 1, stability and parity (next).** Bring back every ❌ above, in the same order as the list, with tests for
   each. Keep 0.1.0's look and layout exactly.
2. **Phase 2, phones.** The back button (a Tauri back-button handler and a screen history), safe areas everywhere,
   keyboard resizing, background calls and call volume through the native plugin, and screen share on Android through
   MediaProjection. Test on a real phone and on Windows (Nev) and Linux before moving on.
3. **Phase 3, more Rust, measured.** Move work into Rust only where it measurably lowers RAM or CPU:
   - Screen capture straight to the encoder; PipeWire app audio on Linux, the way Vesktop's venmic does it.
   - Image and GIF decoding and caching, and the banner marker.
   - The Stoat connection and a message cache (SQLite), so the interface holds only what's on screen.
   - Linux voice.

   Memory is measured before and after each move.
4. **Phase 4, polish.** Release workflow (tag to GitHub Release with every platform), code signing if wanted, the
   README and FEATURES.md.

## Open questions for the owner

- **Android package name:** keep `app.mustela.client` (updates in place, nobody is signed out) or switch to
  `com.mustela.stoat`, which 0.1.0 users would have to install as a new app? Recommended: keep it.
- **Licence:** the repository has AGPL-3.0 (copied from the earlier rebuild). Since this version contains no Stoat app
  code, MIT or AGPL are both possible.
