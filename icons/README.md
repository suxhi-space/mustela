# App icon

Put your icon here and rebuild. The build script turns it into every size each platform needs
(Windows `.ico`, macOS `.icns`, Linux PNGs, Android launcher icons) and also uses it on the sign-in screen.

| File | What it's for |
|---|---|
| `app-icon.png` | **The icon.** Square PNG, 1024×1024, transparent corners. Replace this file to change the app icon. |
| `app-icon.svg` | The source of the default icon (an original drawing of a stoat bounding in an "M"). Edit it and export to `app-icon.png`, or ignore it. |
| `overrides/` | Optional. Drop a hand-made `icon.ico`, `icon.icns`, `32x32.png`, `128x128.png` or `128x128@2x.png` here to use it instead of the generated one for that size. |

To regenerate the icons without building: `npx tauri icon icons/app-icon.png`

Tips:
- Keep important details away from the edges. Android crops launcher icons into circles and squircles.
- macOS and iOS-style icons look best with their own rounded tile, like the default one. Windows and Linux are fine either way.
