/**
 * Mobile or desktop screens, decided once at start-up. A desktop or Android build fixes it at build time
 * (__UI__, see vite.config.ts), so code behind `if (MOBILE_UI)` isn't even in the other build. The web build
 * and the dev server decide by the device: phones and tablets (touch first) get the mobile screens.
 */
export const MOBILE_UI: boolean =
  __UI__ === "mobile" ? true
  : __UI__ === "desktop" ? false
  : typeof matchMedia !== "undefined" && (matchMedia("(max-width: 700px)").matches || (matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches));
