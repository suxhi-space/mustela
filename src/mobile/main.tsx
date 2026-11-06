import { render } from "solid-js/web";
import { App } from "../ui/App";
import "../ui/styles.css";
import { installGlobalContextMenu } from "../ui/menu";
import { startPerfLog } from "../ui/perfLog";
import "./mobile.css";
import { installGestures } from "./gestures";
import { startAppSize } from "../ui/appSize";

/**
 * Phones and tablets (Android, and the web on a touch device): the touch layout on every screen size, the phone's
 * own edges, swipes (gestures.ts) and mobile-only styles (mobile.css). The shared screens are being replaced by
 * mobile ones a screen at a time.
 */
export function start(root: HTMLElement) {
  document.documentElement.dataset.ui = "mobile";
  installGlobalContextMenu(); // hold-to-open menus on touch
  installGestures();
  startAppSize(); // Accessibility > App size (follows the phone's font size by default)
  startPerfLog(); // Settings > Advanced > Copy performance report
  render(() => <App />, root);
}
