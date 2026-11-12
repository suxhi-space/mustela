import "@fontsource-variable/nunito";
// Name-style fonts. Each is only downloaded by the page when a name on screen uses it.
import "@fontsource-variable/lora";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/dancing-script";
import "@fontsource/righteous";
import { MOBILE_UI } from "./ui/target";

/*
 * Two sets of screens on one shared core (src/lib, and the parts of src/ui both use): desktop and mobile.
 * A build for one platform only contains its own set (__UI__ is fixed at build time, so the other import is
 * dropped); the web build loads whichever fits the device.
 */
const root = document.getElementById("root")!;
// Signed in to a real account: start fetching the connection code now, alongside the app's own code, instead of
// only once the app is up (the import in store.ts then finds it already loaded).
try { if (/"kind":"stoat"/.test(localStorage.getItem("mustela:accounts") ?? "")) void import("./lib/backend/stoat"); } catch { /* storage off */ }
if (MOBILE_UI) void import("./mobile/main").then((m) => m.start(root));
else void import("./desktop/main").then((m) => m.start(root));
