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
if (MOBILE_UI) void import("./mobile/main").then((m) => m.start(root));
else void import("./desktop/main").then((m) => m.start(root));
