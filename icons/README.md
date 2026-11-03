# App icon

Put your icon here and rebuild. The build script turns it into every size each platform needs
(Windows `.ico`, macOS `.icns`, Linux PNGs, Android launcher icons) and also uses it on the sign-in screen.

| File | What it's for |
|---|---|
| `app-icon.png` | **The icon** (made from `app-icon.svg`). Square PNG, 1024×1024, transparent corners. Replace this file to change the app icon on Windows, Linux and Android. |
| `app-icon.svg` | Its source drawing. The sign-in screen and title bar use it directly. |
| `app-icon-macos.png` | The macOS icon on its rounded tile (a flat version of `macos/Mustela.icon`). Used on macOS 11–15, and on newer Macs when the build can't compile the glass icon. |
| `macos/Mustela.icon` | The macOS 26+ (Liquid Glass) icon from Apple's Icon Composer. A Mac build with Xcode 26 or later compiles it into the app; open it in Icon Composer to edit it. |
| `overrides/` | Optional. Drop a hand-made `icon.ico`, `icon.icns`, `32x32.png`, `128x128.png` or `128x128@2x.png` here to use it instead of the generated one for that size. |

To regenerate the icons without building: `npx tauri icon icons/app-icon.png`

Tips:
- Keep important details away from the edges. Android crops launcher icons into circles and squircles.
- Windows, Linux and Android use the free-standing mark; only macOS gets the tile.

## Tray and notification icons

| File | What it's for |
|---|---|
| `tray/tray.svg` | The tray icon. Mustela draws it itself with the round dot (the `<circle>` at the end of the file) in your status colour: green online, yellow idle, blue focus, red busy, grey invisible, and a white centre while you're in a call. |
| `tray/tray.png` | The same with a green dot, shown for the moment at start-up before Mustela draws its own. |
| `notification.png` | Optional. Android's small icon in the status bar and on notifications: a **white** shape on a transparent background, about 96×96. Without it Android's own phone icon is used. |

The tray icon has its own outline, so the one picture works on light and dark taskbars. Replace the files and
build; the build script copies them where they're needed. Desktop notifications show the sender's picture
and the app icon, so they follow `app-icon.png`.
