/**
 * Mustela's own server (profiles, activity), if this build has one: scripts/build.mjs asks for its address.
 * Kept in its own tiny file so the app's start-up code can use it without loading the whole server code.
 */
export const OFFICIAL_SERVER = (() => {
  try {
    const u = new URL(String(import.meta.env.VITE_MUSTELA_SERVER ?? "").trim());
    return u.protocol === "https:" ? u.origin : "";
  } catch { return ""; }
})();
