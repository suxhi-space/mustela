# Build 3 checklist

Work stays in `mustela-0.1.5-build3`. The restored 0.1.5-build2 folders are not edited. Nothing here was tried on a phone or in a live call. “Coded” means the source matches the note. It is not a device test.

## Locked decisions

- [x] Desktop screen picker stays. Windows sound: No sound, This app (that window only), Everything but Mustela (system sound, Mustela left out).
- [x] Capture stays 720p30 / 1080p30 / 1080p60, bilinear resize, JPEG 72/78, then VP8. Do not drop to 15 fps. Do not switch to JPEG XL or H.264 unless asked.
- [x] Phone stream full screen stays inside Mustela. Do not use the system video player.
- [x] Status bar hides only while watching someone else’s stream and Mustela’s own call buttons are hidden. When those buttons show, the status bar comes back. Swipe from the top can show it briefly. Navigation bar stays. The rest of the app does not hide the status bar.
- [x] Mac glass icon artwork is not edited. A glass icon still needs a Mac build with Xcode 26.
- [x] Android launcher uses the full tile, not an adaptive circle.

## Coded in this folder, not device-tested

- [x] Bottom sheets ease up (~0.7s) and stay content-sized when the content is short.
- [x] Mobile profile card uses the app text size, font, density, and zoom.
- [x] Esc hint under Settings close is desktop-only.
- [x] Phone settings page is a solid full-screen page under the status bar (mobile shell, width under 900px).
- [x] Emoji and settings scroll no longer use content-visibility on those lists.
- [x] Avatar decorations are not clipped by content-visibility on the whole message.
- [x] Instagram and vxinstagram of the same post share one card.
- [x] Chat videos and embeds can go full screen. Search Media includes embeds.
- [x] Phone DM that is the active call uses the full call view. Chat opens from the call button.
- [x] A picture or video attachment that fails to load leaves no empty block.
- [x] Tap a stream you are watching to hide the call buttons immediately. Tap again to bring them back. The tap does not unfocus the stream.
- [x] Full-screen button on a stream you are watching. In-app stage fill.
- [x] Status bar follows those call buttons, Android only, while that stream is focused or stage-filled.
- [x] Android nav-mode changes reapply insets without a restart.
- [x] Tablet PiP floor and in-app mini-call pinch floor raised. Android PiP source about 108dp.
- [x] Mini call is a flat color.
- [x] Tray icon slot: Windows 32, Linux 24, Mac menu bar 22, drawn a bit larger inside the slot.

## Still open

- [ ] GPU encode for screen share. The JPEG-then-VP8 path is why a stream costs more than Discord, Vesktop, or Stoat. Not started.
- [x] YouTube cards stay as they are.
- [x] A GIF or other embed that fails to load leaves no empty block.
- [x] A short profile sheet stays as tall as its content.
- [ ] AppImage. The updater already uses https://github.com/suxhi-space/mustela/releases. This PC cannot build a Linux AppImage (no WSL, no Docker).
- [ ] Android APK and a real phone. Status bar, landscape, and stage fill cannot be seen until then.
- [ ] Full pass of docs/REQUIREMENTS.md. Most items there are marked built and still need a device.
