<p align="center"><img src="icons/app-icon.png" width="112" alt="Mustela icon"></p>

<h1 align="center">Mustela</h1>

<p align="center">A <a href="https://stoat.chat">Stoat</a> chat client for Windows, macOS, Linux and Android,<br>with Discord-style profile customization and a tactile, 3D look.</p>

<p align="center"><img src="docs/screenshots/server-dark.png" width="820" alt="Mustela showing a server channel in dark mode"></p>
<p align="center"><img src="docs/screenshots/dm-light.png" width="520" alt="A server channel in light mode"> <img src="docs/screenshots/phone.png" width="200" alt="Mustela on a phone"></p>

Mustela connects to Stoat (formerly Revolt), on stoat.chat or a self-hosted instance. It keeps Stoat's familiar
layout: servers on the left, channels, chat, members. It adds profile decorations, effects, frames and nameplates
that other Mustela users can see, without any extra server.

## Features

**Chat**
- Servers with categories, server banners, unread and mention badges, muting respected
- Home with Friends (online, all, pending, blocked, add by username), DMs, groups and Saved Notes
- Messages with Stoat markdown: **bold**, *italic*, ~~strike~~, `code`, code blocks, quotes, lists, headings, `||spoilers||`, links, mentions, custom emoji, timestamps
- Replies (with mention toggle), reactions, edit (or press ↑), delete, copy
- Images, video, audio and files: send by button, paste or drag-and-drop; view in a lightbox
- Link embeds, typing indicators, older history as you scroll up, jump to present
- Emoji picker and `:shortcode` / `@mention` autocomplete
- Notifications for DMs and mentions
- Join servers from an invite link
- Multiple accounts with a one-tap switcher

**Voice and video**
- Voice, camera and screen share (LiveKit, through Stoat's call API)
- Pop-out call window on desktop, like Discord
- On Android, calls keep going when you swipe the app away (background call service)

**Profiles** (seen by other Mustela users)
- Avatar decorations, profile effects (falling petals, snow, fireflies…), profile frames, nameplates
- Profile theme colors and display-name fonts and effects
- Every item has a performance rating (Excellent, Good, Heavy, Very Poor). You choose the heaviest thing you'll see animated.

**Look**
- *3D*: panels float over a starfield (or your own picture) with chunky, pressable buttons, in the spirit of VRChat's menus. *Flat*: the same layout without depth.
- 9 color themes plus any custom color, each in light and dark, with an optional pure black mode
- Android 12+ can follow your wallpaper colors (Material You)
- Window transparency on desktop: Mica, Acrylic and Blur on Windows, Vibrancy on macOS, see-through on Linux
- Compact, default and comfy density; cozy or compact messages
- Settings sync across your devices through your Stoat account

## Build it yourself

You don't need to install anything first. The build script finds what's missing and offers to install it:

| Missing | What the script does |
|---|---|
| Node.js | `build.sh` / `build.cmd` download a private copy into `~/.mustela/toolchain` |
| Rust | runs the official rustup installer (your user only) |
| Xcode command line tools (macOS) | opens Apple's installer and waits for it |
| Visual Studio C++ build tools (Windows) | installs them with `winget` (asks first) |
| WebKitGTK & friends (Linux) | installs them with apt, dnf, pacman or zypper (asks for your password first) |
| Java 17, Android SDK, NDK | downloads them into `~/.mustela/toolchain` (about 1.7 GB, asks first) |

Existing installs (Android Studio, Homebrew Java, etc.) are found and reused. Pass `--yes` to accept every prompt.

```sh
git clone https://github.com/YOUR-NAME/mustela.git
cd mustela
./build.sh          # macOS / Linux
build.cmd           # Windows
```

The script asks which platform to build, checks your setup and tells you exactly what's missing.
It then installs dependencies, generates icons and builds. Finished files land in `release/<platform>/`.

To skip the menu:

```sh
./build.sh --platform linux        # or: windows, macos, android, web
./build.sh --platform android --debug
npm run app -- --platform linux    # same thing through npm
```

| Platform | Build on | You get | Extra setup |
|---|---|---|---|
| Windows | Windows 10/11 | `.exe` installer, `.msi` | installed for you (Visual Studio C++ build tools) |
| macOS | a Mac | Universal `.app` and `.dmg` (Apple Silicon + Intel) | installed for you (Xcode command line tools) |
| Linux | Linux | `.AppImage`, `.deb` | installed for you (WebKitGTK dev packages) |
| Android | any of the above | signed `.apk`, `.aab` | installed for you (Java 17, Android SDK + NDK) |
| Web | anywhere | static site in `release/web` | none |

Desktop apps can only be built on their own OS. To build all of them from one place, push to GitHub, open
**Actions > Release > Run workflow** and pick a platform (or *all*). Pushing a tag like `v0.2.0` builds everything
and opens a draft GitHub Release with the files attached.

### Change the icon

Replace `icons/app-icon.png` (1024×1024 PNG) and build. Every platform's icon sizes are generated from it.
See [`icons/README.md`](icons/README.md).

### Android signing

The first release build creates a personal signing key in `.signing/`. **Back that folder up and never commit it.**
Android only installs updates signed with the same key. For GitHub builds, add your key as repository secrets
(`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`).

### macOS and Windows warnings

The builds aren't notarized or code-signed (that needs paid Apple/Microsoft certificates). On macOS, right-click
the app and choose **Open** the first time. On Windows, choose **More info > Run anyway** if SmartScreen appears.

## Develop

```sh
npm install
npm run dev          # browser preview at http://localhost:1420. "Explore the demo" needs no account.
npm run tauri dev    # the desktop app with hot reload
npm test             # unit tests
npm run typecheck
```

```
src/lib/        app logic, no UI: Stoat backend, demo backend, markdown, profiles, sync, themes
src/ui/         Solid components and styles.css
src-tauri/      Rust shell: window materials, pop-out window, safe image fetcher
src-tauri/plugins/mustela-native/   Android: wallpaper colors + background call service (Kotlin)
scripts/build.mjs   the build script
icons/          your app icon
```

## How profile customization works without a server

Your profile settings pack into about 20 bytes. When you press **Publish**, Mustela re-uploads your Stoat banner
with those bytes drawn as a thin strip of gray blocks along the bottom. Other Mustela clients read the strip and
draw your decoration, effect, frame and nameplate locally. Mustela hides the strip; other Stoat apps show it as a
thin gray bar on your banner. Everything is drawn procedurally on the viewer's device, and the performance rating
is computed from the settings themselves, so nobody can make their profile lag your phone.

## Status

This is an early release. What has been checked, and how:

| Area | State |
|---|---|
| UI, demo mode, markdown, profiles, themes, build script | Tested: 160 unit tests, plus clicked through in a browser in light, dark and phone layouts |
| Linux desktop app | Built with the build script on Linux |
| Stoat connection (login, servers, messages, uploads, friends, sync) | Written against the official `stoat.js` SDK types. **Not yet run against a live Stoat server.** Please report what breaks. |
| Voice, camera, screen share | Written, not yet tried on a live call |
| Windows, macOS, Android builds | Set up in the build script and GitHub workflow, not yet built |
| Android background calls | Written (Kotlin foreground service + LiveKit Android), not yet compiled or run on a device |

Known limits:
- Sign-in tokens are kept in the app's local storage, not the OS keychain.
- Linux window blur only shows if your desktop's compositor blurs windows (KDE can).
- Android background-call mode is voice only; switch to the Web call engine in Settings for camera and screen share.
- Not yet built: message search, pinned messages view, server settings and moderation, creating servers, custom status editing, voice input sensitivity.

## Credits

Built on [Tauri](https://tauri.app), [Solid](https://www.solidjs.com), [stoat.js](https://github.com/stoatchat/javascript-client-sdk),
[LiveKit](https://livekit.io), Google's [Material Color Utilities](https://github.com/material-foundation/material-color-utilities)
and the [Nunito](https://fonts.google.com/specimen/Nunito) typeface. Not affiliated with Stoat. Profile decorations are original procedural
designs. No artwork from Discord or anyone else is included.
